// Real PubChem REST API integration (Phase 3)
// Replaces mocks/pubchem.js for get_molecule_3d tool calls

import QuickLRU from 'quick-lru';
import PQueue from 'p-queue';

const PUBCHEM_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';

// SDF V2000 charge code → formal charge integer
const CHARGE_CODES = { 0: 0, 1: 3, 2: 2, 3: 1, 4: 0, 5: -1, 6: -2, 7: -3 };

// 무제한 Map → LRU 캐시 (TTL 1시간)
// 이름→CID는 안정적이라 더 크게, 분자 데이터는 메모리 비용 고려해 작게
const cidCache = new QuickLRU({ maxSize: 2000, maxAge: 1000 * 60 * 60 * 6 });
const molCache = new QuickLRU({ maxSize: 500,  maxAge: 1000 * 60 * 60 });

// PubChem rate limit 방지를 위한 동시성 제한
// API key 없이 5 req/s, key 있으면 10 req/s. 우리는 fetch당 평균 2 req(name→cid, cid→sdf)
// 안전하게 3로 두면 burst 시에도 한 분자 처리당 슬롯 1개라 OK.
const pubchemQueue = new PQueue({
  concurrency: 3,
  intervalCap: 5,        // 1초에 최대 5건
  interval: 1000,
});

function apiHeaders() {
  const key = process.env.PUBCHEM_API_KEY;
  return key ? { 'X-API-KEY': key } : {};
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: apiHeaders() });
  if (!res.ok) {
    const err = new Error(`PubChem HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: apiHeaders() });
  if (!res.ok) {
    const err = new Error(`PubChem HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

async function nameToCid(name) {
  const key = name.toLowerCase().trim();
  if (cidCache.has(key)) return cidCache.get(key);

  const url = `${PUBCHEM_BASE}/compound/name/${encodeURIComponent(name)}/cids/JSON`;
  const data = await pubchemQueue.add(() => fetchJson(url));
  const cid = data.IdentifierList?.CID?.[0];
  if (!cid) throw new Error(`PubChem: CID not found for "${name}"`);

  cidCache.set(key, cid);
  return cid;
}

// Try 3D conformer first; fall back to 2D (z=0 plane) if 404
async function fetchSdf(cid) {
  try {
    const sdf = await pubchemQueue.add(() => fetchText(`${PUBCHEM_BASE}/compound/cid/${cid}/SDF?record_type=3d`));
    return { sdf, is3d: true };
  } catch (e) {
    if (e.status === 404) {
      const sdf = await pubchemQueue.add(() => fetchText(`${PUBCHEM_BASE}/compound/cid/${cid}/SDF?record_type=2d`));
      return { sdf, is3d: false };
    }
    throw e;
  }
}

// Parse MDL/SDF V2000 format → { atoms[], bonds[] }
export function parseSdf(sdf, cid, name) {
  const lines = sdf.split(/\r?\n/);

  // Counts line contains "V2000"
  const ci = lines.findIndex(l => l.includes('V2000'));
  if (ci === -1) throw new Error('SDF parse error: V2000 counts line not found');

  const numAtoms = parseInt(lines[ci].substring(0, 3));
  const numBonds = parseInt(lines[ci].substring(3, 6));
  if (!numAtoms || numAtoms < 1) throw new Error('SDF parse error: atom count is 0');

  const atoms = [];
  const elementCount = {};

  for (let i = 0; i < numAtoms; i++) {
    const line = lines[ci + 1 + i] || '';

    // V2000 fixed-width: x(0-9) y(10-19) z(20-29) space element(31-33) massDiff(34-35) charge(36-38)
    const x = parseFloat(line.slice(0, 10));
    const y = parseFloat(line.slice(10, 20));
    const z = parseFloat(line.slice(20, 30));
    const element = line.slice(31, 34).trim();
    const chargeCode = parseInt(line.slice(36, 39).trim()) || 0;
    const formalCharge = CHARGE_CODES[chargeCode] ?? 0;

    if (!element) continue;

    elementCount[element] = (elementCount[element] || 0) + 1;
    const id = `${element}${elementCount[element]}`;

    let label = element;
    if (formalCharge > 0) label = `${element}⁺`;
    else if (formalCharge < 0) label = `${element}⁻`;

    atoms.push({
      id,
      element,
      label,
      position: { x, y, z },
      formalCharge,
      hybridization: null,
      visible: true,
    });
  }

  const bonds = [];
  for (let i = 0; i < numBonds; i++) {
    const line = lines[ci + 1 + numAtoms + i] || '';
    const a1idx = parseInt(line.slice(0, 3)) - 1; // SDF is 1-indexed
    const a2idx = parseInt(line.slice(3, 6)) - 1;
    const type  = parseInt(line.slice(6, 9)) || 1;
    const order = type > 3 ? 1 : type; // aromatic (4) → single

    if (a1idx >= 0 && a2idx >= 0 && a1idx < atoms.length && a2idx < atoms.length) {
      bonds.push({ atom1Id: atoms[a1idx].id, atom2Id: atoms[a2idx].id, order });
    }
  }

  inferHybridization(atoms, bonds);

  return { pubchemCid: cid, name, iupacName: name, formula: '', atoms, bonds };
}

// Infer sp/sp2/sp3 from bond orders
function inferHybridization(atoms, bonds) {
  const bondMap = Object.fromEntries(atoms.map(a => [a.id, []]));
  bonds.forEach(b => {
    bondMap[b.atom1Id]?.push(b.order);
    bondMap[b.atom2Id]?.push(b.order);
  });

  atoms.forEach(a => {
    if (!['C', 'N', 'O', 'P', 'S'].includes(a.element)) return;
    const orders = bondMap[a.id] || [];
    if (orders.includes(3)) {
      a.hybridization = 'sp';
    } else if (orders.includes(2)) {
      a.hybridization = 'sp2';
    } else {
      a.hybridization = 'sp3';
    }
  });
}

// Main export: fetch + parse molecule by name
export async function getMolecule3D(name) {
  try {
    const cid = await nameToCid(name);

    if (molCache.has(cid)) return molCache.get(cid);

    const { sdf, is3d } = await fetchSdf(cid);
    const mol = parseSdf(sdf, cid, name);

    if (!is3d) {
      console.warn(`[PubChem] "${name}" has no 3D conformer, using 2D (z=0)`);
    } else {
      console.log(`[PubChem] Loaded CID ${cid} "${name}" — ${mol.atoms.length} atoms, ${mol.bonds.length} bonds`);
    }

    molCache.set(cid, mol);
    return mol;
  } catch (e) {
    console.warn(`[PubChem] Failed to fetch "${name}": ${e.message}`);
    return null;
  }
}

// 테스트/디버깅용 헬퍼
export const __test__ = { cidCache, molCache, pubchemQueue };
