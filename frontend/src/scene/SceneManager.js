import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { gsap } from 'gsap';
import {
  createAtomMesh, createPOrbitalLobes,
  ATOM_MASSES, ELEMENT_NAMES,
  getAtomRadius, colorHex,
} from './AtomFactory.js';
import { createBondMeshes, updateBondMeshes } from './BondFactory.js';

export class SceneManager {
  // Three.js core
  #scene; #camera; #renderer; #controls;

  // Scene objects
  #atomRegistry  = new Map();  // atomId → { mesh, initPos }
  #bondRegistry  = new Map();  // "a1|a2" → { meshes, order }
  #dynBonds      = [];         // { meshes, a1Id, a2Id }
  #orbitalGroups = new Map();  // atomId → THREE.Group
  #allAtomMeshes = [];
  // opacity 애니메이션 등으로 cloned된 material 추적 → 재clone 또는 #clearScene 시 dispose
  #clonedMaterials = new Set();

  // Per-mesh metadata for tooltip
  #atomMeta = new WeakMap();

  // Raycasting
  #raycaster = new THREE.Raycaster();
  #mouse     = new THREE.Vector2(-9999, -9999);
  #hoveredMesh = null;

  // DOM references (passed in by App.js)
  #containerEl;
  #tooltipEl;
  #resultBadgeEl;
  #resultBadgeValueEl;

  // 페이지 가시성 상태 — hidden일 때 render 일시중지
  #paused = false;

  // Callbacks
  onAtomHover = null;
  onLabelShow = null;

  // ────────────────────────────────────────────────────────
  init(canvasEl, containerEl, tooltipEl, resultBadgeEl) {
    this.#containerEl        = containerEl;
    this.#tooltipEl          = tooltipEl;
    this.#resultBadgeEl      = resultBadgeEl;
    this.#resultBadgeValueEl = resultBadgeEl?.querySelector('.badge-value');

    const w = containerEl.clientWidth  || (window.innerWidth  - 220 - 370);
    const h = containerEl.clientHeight || window.innerHeight;

    this.#scene  = new THREE.Scene();
    this.#camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
    this.#camera.position.set(6, 4, 8);

    this.#renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
    this.#renderer.setSize(w, h);
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

    this.#controls = new OrbitControls(this.#camera, this.#renderer.domElement);
    this.#controls.enableDamping = true;
    this.#controls.dampingFactor = 0.05;

    // Lighting (전역 — clearScene에서 제거하지 않음)
    this.#scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(10, 15, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.width = sun.shadow.mapSize.height = 2048;
    this.#scene.add(sun);
    const back = new THREE.PointLight(0x339af0, 0.8);
    back.position.set(-10, -10, -10);
    this.#scene.add(back);

    // Resize
    window.addEventListener('resize', () => {
      const nw = containerEl.clientWidth  || w;
      const nh = containerEl.clientHeight || h;
      this.#camera.aspect = nw / nh;
      this.#camera.updateProjectionMatrix();
      this.#renderer.setSize(nw, nh);
    });

    // 페이지 가시성 변경 시 render pause/resume
    document.addEventListener('visibilitychange', () => {
      this.#paused = document.hidden;
    });

    // Mouse for hover
    canvasEl.addEventListener('mousemove', e => {
      const rect = canvasEl.getBoundingClientRect();
      this.#mouse.x =  ((e.clientX - rect.left)  / rect.width)  * 2 - 1;
      this.#mouse.y = -((e.clientY - rect.top)   / rect.height) * 2 + 1;
      if (tooltipEl) {
        tooltipEl.style.left = (e.clientX + 14) + 'px';
        tooltipEl.style.top  = (e.clientY - 10) + 'px';
      }
    });

    this.#animate();
  }

  // ── Scene building ──────────────────────────────────────
  loadScenario(scenario) {
    this.#clearScene();
    if (this.#resultBadgeEl) this.#resultBadgeEl.classList.remove('visible');

    scenario.molecules.forEach(mol => this.#buildMolecule(mol));

    if ((scenario.molecules?.length ?? 0) > 1) {
      this.#fitCamera();
    }
  }

  // 전체 원자의 무게중심 + 바운딩 반지름으로 카메라 자동 조정
  // 좁은 가로 화면에서 분자가 잘리지 않도록 horizontal/vertical FOV 중 작은 쪽 사용
  // 큰 원자(Br/I)가 외곽에 있는 경우도 잘리지 않도록 atom radius 포함
  #fitCamera() {
    const meshes = this.#allAtomMeshes.filter(m => m.visible);
    if (!meshes.length) return;

    const centroid = new THREE.Vector3();
    meshes.forEach(m => centroid.add(m.position));
    centroid.divideScalar(meshes.length);

    let radius = 1;
    meshes.forEach(m => {
      const el = m.userData.element;
      const r  = getAtomRadius(el);
      const d  = centroid.distanceTo(m.position) + r;
      if (d > radius) radius = d;
    });

    const fovV = (this.#camera.fov * Math.PI) / 180;
    const aspect = this.#camera.aspect || 1;
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect);
    const fovMin = Math.min(fovV, fovH);
    const dist = (radius * 1.6) / Math.tan(fovMin / 2);

    const camDir = new THREE.Vector3(0.6, 0.4, 0.8).normalize();
    this.#camera.position.copy(centroid).addScaledVector(camDir, dist);
    this.#controls.target.copy(centroid);
    this.#controls.update();
  }

  #buildMolecule(mol, xOffset = 0) {
    const bondAdj = {};
    mol.atoms.forEach(a => (bondAdj[a.id] = []));
    mol.bonds.forEach(b => {
      bondAdj[b.atom1Id]?.push({ id: b.atom2Id, order: b.order });
      bondAdj[b.atom2Id]?.push({ id: b.atom1Id, order: b.order });
    });

    mol.atoms.forEach(atomDef => {
      const shifted = { ...atomDef, position: { x: atomDef.position.x + xOffset, y: atomDef.position.y, z: atomDef.position.z } };
      const mesh = createAtomMesh(shifted);
      this.#scene.add(mesh);

      const bondsForMeta = (bondAdj[atomDef.id] || []).map(b => {
        const neighbour = mol.atoms.find(a => a.id === b.id);
        return { lbl: neighbour?.label || b.id, el: neighbour?.element || '?', ord: b.order };
      });

      this.#atomMeta.set(mesh, {
        id: atomDef.id, element: atomDef.element, label: atomDef.label || atomDef.id,
        hyb: atomDef.hybridization, charge: atomDef.formalCharge ?? 0, bonds: bondsForMeta,
      });
      this.#allAtomMeshes.push(mesh);

      const initPos = new THREE.Vector3(shifted.position.x, shifted.position.y, shifted.position.z);
      this.#atomRegistry.set(atomDef.id, { mesh, initPos: initPos.clone() });

      if (atomDef.hybridization === 'sp2' && (atomDef.formalCharge ?? 0) > 0) {
        const orbGroup = createPOrbitalLobes(shifted.position);
        this.#scene.add(orbGroup);
        this.#orbitalGroups.set(atomDef.id, orbGroup);
      }
    });

    // 모든 결합을 dynBonds에 등록 → 시나리오 중 어느 원자가 움직여도 결합이 따라감.
    // 매 프레임 비용: 분자당 결합 수 × (vector 계산 + matrix 갱신). 일반 분자(< 100 bonds)에선 미미.
    mol.bonds.forEach(b => {
      const a1 = this.#atomRegistry.get(b.atom1Id);
      const a2 = this.#atomRegistry.get(b.atom2Id);
      if (!a1 || !a2) return;

      const meshes = createBondMeshes(a1.mesh.position, a2.mesh.position, b.order);
      meshes.forEach(m => this.#scene.add(m));
      this.#bondRegistry.set(`${b.atom1Id}|${b.atom2Id}`, { meshes, order: b.order });
      this.#dynBonds.push({ meshes, a1Id: b.atom1Id, a2Id: b.atom2Id });
    });
  }

  // ── Three.js 리소스 정리 ───────────────────────────────
  // sharedGeometry/sharedMaterial로 표시된 원자 메시는 dispose하지 않음 (캐시 공유)
  // bond mesh는 매번 신규 생성되므로 반드시 dispose
  // cloned material은 #clonedMaterials Set에서 dispose
  #disposeObject(obj) {
    obj.traverse?.(child => {
      // geometry: shared가 아니면 dispose
      if (child.geometry && !child.userData?.sharedGeometry) {
        child.geometry.dispose();
      }
      // material: shared가 아니면 dispose (배열 형태도 대응)
      const mat = child.material;
      if (mat && !child.userData?.sharedMaterial) {
        if (Array.isArray(mat)) mat.forEach(m => m.dispose?.());
        else mat.dispose?.();
      }
    });
    // orbital group의 별도 material
    if (obj.userData?.orbitalMaterial) {
      obj.userData.orbitalMaterial.dispose?.();
    }
  }

  #clearScene() {
    const toRemove = [];
    this.#scene.children.forEach(c => {
      if (!(c instanceof THREE.Light)) toRemove.push(c);
    });
    toRemove.forEach(c => {
      this.#scene.remove(c);
      this.#disposeObject(c);
    });

    // opacity 애니메이션 등으로 clone된 material 전부 dispose
    this.#clonedMaterials.forEach(m => m.dispose?.());
    this.#clonedMaterials.clear();

    this.#atomRegistry.clear();
    this.#bondRegistry.clear();
    this.#dynBonds = [];
    this.#orbitalGroups.clear();
    this.#allAtomMeshes = [];
    this.#hoveredMesh = null;
    this.#camera.position.set(6, 4, 8);
    this.#controls.target.set(0, 0, 0);
  }

  // ── Animation steps ─────────────────────────────────────
  // highlight pulse 헬퍼 — 강조 효과는 항상 다음 규칙을 따른다:
  //   1) peak scale은 코드가 1.5로 고정 (LLM이 1.1/1.2 같은 미세한 값을 줘도 명확히 보이게)
  //   2) 빠르게 키웠다 줄이기를 3번 반복(yoyo + repeat:5 = 6 legs = 3 cycles)
  //   3) sine.inOut 이징 — yoyo의 forward/back 전환이 자연스러움
  //   4) leg 1개당 ≥ 250ms 보장 → 총 ~1.5s, 사람 눈에 또렷이 인지 가능
  //   5) 종료 시 반드시 baseline scale (1,1,1)로 복귀 — 비율 깨짐 방지
  // step.type === 'highlight'이거나 property === 'highlight'인 경우 적용.
  #addHighlightPulse(tl, mesh, dur) {
    const PEAK   = 1.5;
    const legDur = Math.max(0.25, dur / 6);
    tl.to(mesh.scale,
      { x: PEAK, y: PEAK, z: PEAK, duration: legDur, ease: 'sine.inOut', yoyo: true, repeat: 5 },
      0,
    );
    tl.set(mesh.scale, { x: 1, y: 1, z: 1 });
  }

  async playStep(step) {
    return new Promise(resolve => {
      const tl = gsap.timeline({ onComplete: resolve });
      const dur = (step.duration || 1000) / 1000;
      const isHighlightStep = step.type === 'highlight';

      (step.targets || []).forEach(target => {
        const ease = target.ease || 'power2.inOut';

        // Camera move
        if (target.property === 'camera') {
          const to = target.to;
          tl.to(this.#camera.position, {
            x: to.x, y: to.y, z: to.z, duration: dur, ease,
            onUpdate: () => { this.#camera.lookAt(0, 0, 0); this.#controls.target.set(0,0,0); },
          }, 0);
          return;
        }

        // Label / badge
        if (target.property === 'label') {
          tl.call(() => this.#showLabel(target.to.text, target.to.color), null, dur * 0.5);
          return;
        }

        const reg = this.#atomRegistry.get(target.atomId);
        if (!reg) return;
        const { mesh } = reg;

        if (target.property === 'position') {
          tl.to(mesh.position, { x: target.to.x, y: target.to.y, z: target.to.z, duration: dur, ease }, 0);
        }

        else if (target.property === 'visible') {
          if (target.to === true) {
            mesh.visible = true;
            mesh.scale.set(0, 0, 0);
            tl.to(mesh.scale, { x: 1, y: 1, z: 1, duration: Math.min(dur, 0.5), ease: 'back.out(1.7)' }, 0);
          } else {
            tl.to(mesh.scale, { x: 0, y: 0, z: 0, duration: Math.min(dur, 0.4), ease }, 0);
            tl.call(() => { mesh.visible = false; });
          }
        }

        else if (target.property === 'scale') {
          const s = typeof target.to === 'number' ? { x: target.to, y: target.to, z: target.to } : target.to;
          // step.type === 'highlight'이면 LLM이 어떤 값을 보내든 코드가 1.5 peak로 자동 pulse + reset 처리.
          // (LLM이 to:1.1 같은 작은 값을 줘도 명확히 보이도록 peak는 코드가 결정)
          if (isHighlightStep) {
            this.#addHighlightPulse(tl, mesh, dur);
          } else {
            tl.to(mesh.scale, { x: s.x, y: s.y, z: s.z, duration: dur, ease }, 0);
          }
        }

        else if (target.property === 'opacity') {
          // 캐시된 material을 mutate하면 다른 원자에도 영향 → clone 필요.
          // 이미 cloned면 재clone하지 않음 (이전 clone은 #clonedMaterials에 등록되어
          // 다음 #clearScene에서 dispose됨)
          if (mesh.userData?.sharedMaterial || !mesh.material.transparent) {
            const clone = mesh.material.clone();
            clone.transparent = true;
            mesh.material = clone;
            mesh.userData.sharedMaterial = false;
            this.#clonedMaterials.add(clone);
          }
          tl.to(mesh.material, { opacity: target.to, duration: dur, ease }, 0);
        }

        else if (target.property === 'bond') {
          const { connectTo, action, order = 1 } = target.to;
          if (action === 'form') {
            const a2 = this.#atomRegistry.get(connectTo);
            if (!a2) return;
            tl.call(() => {
              const meshes = createBondMeshes(mesh.position, a2.mesh.position, order);
              meshes.forEach(m => this.#scene.add(m));
              this.#dynBonds.push({ meshes, a1Id: target.atomId, a2Id: connectTo });
              this.#bondRegistry.set(`${target.atomId}|${connectTo}`, { meshes, order });
            }, null, 0);
          } else if (action === 'break') {
            const key1 = `${target.atomId}|${connectTo}`;
            const key2 = `${connectTo}|${target.atomId}`;
            const entry = this.#bondRegistry.get(key1) || this.#bondRegistry.get(key2);
            if (entry) {
              entry.meshes.forEach(m => {
                tl.to(m.scale, { x: 0, y: 0, z: 0, duration: dur, ease }, 0);
                tl.call(() => {
                  this.#scene.remove(m);
                  // bond mesh는 항상 신규 생성된 비공유 리소스
                  m.geometry?.dispose();
                  m.material?.dispose?.();
                });
              });
              this.#bondRegistry.delete(key1);
              this.#bondRegistry.delete(key2);
              this.#dynBonds = this.#dynBonds.filter(d =>
                !(d.a1Id === target.atomId && d.a2Id === connectTo) &&
                !(d.a1Id === connectTo && d.a2Id === target.atomId));
            }
          }
        }

        else if (target.property === 'orbital') {
          const grp = this.#orbitalGroups.get(target.atomId);
          if (!grp) return;
          const scaleVal = target.to.action === 'show' ? 1 : 0;
          grp.children.forEach(lobe => {
            tl.to(lobe.scale, { x: scaleVal, y: scaleVal, z: scaleVal, duration: dur, ease }, 0);
          });
        }

        else if (target.property === 'highlight') {
          this.#addHighlightPulse(tl, mesh, dur);
        }
      });

      if (tl.totalDuration() === 0) resolve();
    });
  }

  resetScene(scenario) {
    if (scenario) {
      this.loadScenario(scenario);
      this.#camera.position.set(6, 4, 8);
      this.#controls.target.set(0, 0, 0);
    }
    if (this.#resultBadgeEl) this.#resultBadgeEl.classList.remove('visible');
  }

  #showLabel(text, color = '#ff00ff') {
    if (this.#resultBadgeEl) {
      if (this.#resultBadgeValueEl) {
        this.#resultBadgeValueEl.textContent = text;
        this.#resultBadgeValueEl.style.color = color;
      }
      this.#resultBadgeEl.classList.add('visible');
    }
    this.onLabelShow?.(text, color);
  }

  // ── Render loop ─────────────────────────────────────────
  #animate = () => {
    requestAnimationFrame(this.#animate);
    if (this.#paused) return;

    this.#controls.update();

    this.#dynBonds.forEach(({ meshes, a1Id, a2Id }) => {
      const a1 = this.#atomRegistry.get(a1Id);
      const a2 = this.#atomRegistry.get(a2Id);
      if (a1 && a2) updateBondMeshes(meshes, a1.mesh.position, a2.mesh.position);
    });

    this.#raycaster.setFromCamera(this.#mouse, this.#camera);
    const hits = this.#raycaster.intersectObjects(this.#allAtomMeshes);
    const hit  = hits.length ? hits[0].object : null;

    if (hit !== this.#hoveredMesh) {
      this.#hoveredMesh = hit;
      const meta = hit ? this.#atomMeta.get(hit) : null;
      this.#updateTooltip(meta);
      this.onAtomHover?.(meta);
    }

    this.#renderer.render(this.#scene, this.#camera);
  };

  #updateTooltip(meta) {
    if (!this.#tooltipEl) return;
    if (!meta) { this.#tooltipEl.classList.remove('visible'); return; }

    const el    = meta.element;
    const color = colorHex(el);
    const name  = ELEMENT_NAMES?.[el] || el;
    const mass  = ATOM_MASSES?.[el] ? `원자량: ${ATOM_MASSES[el]}` : '';

    const bondRows = (meta.bonds || []).map(b => {
      const orderName = b.ord === 1 ? '단일' : b.ord === 2 ? '이중' : '삼중';
      const cls = b.ord === 1 ? 'single' : b.ord === 2 ? 'double' : 'triple';
      return `<div class="bond-chip ${cls}">${orderName}결합 → ${b.lbl}</div>`;
    }).join('');

    const chargeStr = meta.charge > 0 ? `+${meta.charge}` : meta.charge < 0 ? `${meta.charge}` : '0';
    const hybStr    = meta.hyb || '—';

    this.#tooltipEl.innerHTML = `
      <div class="tt-header">
        <div class="tt-symbol" style="background:${color}">${el}</div>
        <div>
          <div class="tt-el-name">${name}</div>
          <div class="tt-mass">${mass}</div>
        </div>
      </div>
      <div class="tt-divider"></div>
      <div class="tt-row"><span class="tt-lbl">라벨</span> ${meta.label}</div>
      <div class="tt-row"><span class="tt-lbl">전하</span> ${chargeStr}</div>
      <div class="tt-row"><span class="tt-lbl">혼성화</span> ${hybStr}</div>
      ${bondRows ? `<div class="tt-divider"></div><div class="bond-list">${bondRows}</div>` : ''}
    `;
    this.#tooltipEl.classList.add('visible');
  }
}
