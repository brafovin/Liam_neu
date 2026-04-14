// =============================================================
// FORTNITE CLONE - Browser Game
// Bauen, Editieren, Schießen in Three.js
// =============================================================

// === 1. GLOBALS ===============================================
const GRID = 4;              // Build grid size (meters)
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.4;
const GRAVITY = 30;
const JUMP_V = 9.5;
const MOVE_SPEED = 6;
const SPRINT_MUL = 1.7;
const MAX_HP = 100;
const MAX_SHIELD = 50;
const AMMO_PER_KILL = 10;
const BUILD_HP = 200;
const BUILD_COST = 10;
const ENEMY_HP_BASE = 40;
const ENEMY_DMG = 8;
const ENEMY_SPEED = 2.8;
const HEAL_AMOUNT = 40;
const MAX_MEDKITS = 9;
const START_MEDKITS = 2;
const RELOAD_TIME = 1.5;
const HEADSHOT_MULT_ENEMY = 2.5;
const HEADSHOT_MULT_BOSS = 2.0;
const HEADSHOT_MULT_DUMMY = 2.5;
const SHOTGUN_RELOAD = 1.8;
const SNIPER_RELOAD = 2.0;

// === WEAPONS ==================================================
// id → stats. dmg=per-pellet damage, cd=time between shots, clip=magazine size,
// start=starting reserve, max=max reserve, spread=random cone radians,
// pellets=raycasts per shot (shotgun), range=max ray, auto=full-auto flag,
// reload=reload time seconds, tracerColor=tracer line color.
const WEAPONS = {
    pistol: {
        id: 'pistol', name: 'Pistole', icon: '🔫',
        dmg: 22, cd: 0.18, clip: 15, start: 60, max: 200,
        spread: 0.015, pellets: 1, range: 200, auto: false,
        reload: RELOAD_TIME, tracerColor: 0xffff66,
    },
    smg: {
        id: 'smg', name: 'SMG', icon: '🔫',
        dmg: 11, cd: 0.055, clip: 40, start: 120, max: 400,
        spread: 0.055, pellets: 1, range: 140, auto: true,
        reload: 1.8, tracerColor: 0xffee88,
    },
    ak: {
        id: 'ak', name: 'AK47', icon: '🗡️',
        dmg: 18, cd: 0.09, clip: 30, start: 90, max: 300,
        spread: 0.045, pellets: 1, range: 180, auto: true,
        reload: 2.0, tracerColor: 0xff9933,
    },
    shotgun: {
        id: 'shotgun', name: 'Schrotflinte', icon: '💥',
        dmg: 14, cd: 0.9, clip: 6, start: 18, max: 60,
        spread: 0.18, pellets: 8, range: 35, auto: false,
        reload: SHOTGUN_RELOAD, tracerColor: 0xffaa44,
    },
    sniper: {
        id: 'sniper', name: 'Sniper', icon: '🎯',
        dmg: 150, cd: 1.5, clip: 3, start: 9, max: 30,
        spread: 0.0, pellets: 1, range: 400, auto: false,
        reload: SNIPER_RELOAD, tracerColor: 0x66ffcc,
    },
    rocket: {
        id: 'rocket', name: 'Raketenwerfer', icon: '🚀',
        dmg: 220, cd: 1.4, clip: 1, start: 3, max: 12,
        spread: 0.0, pellets: 1, range: 250, auto: false,
        reload: 2.8, tracerColor: 0xff6622,
        projectile: true, splashRadius: 6.0, rocketSpeed: 38,
    },
};
// Order matters: slots 1..6 map to this list, and boss kills unlock the NEXT
// locked weapon in order.
const WEAPON_ORDER = ['pistol', 'smg', 'ak', 'shotgun', 'sniper', 'rocket'];

function makeInitialWeaponAmmo() {
    const out = {};
    for (const id of WEAPON_ORDER) {
        out[id] = { clip: WEAPONS[id].clip, reserve: WEAPONS[id].start };
    }
    return out;
}

function makeInitialUnlocks() {
    // Only the pistol is unlocked at the start. Bosses drop the rest.
    const out = {};
    for (const id of WEAPON_ORDER) out[id] = false;
    out.pistol = true;
    return out;
}

// Returns the slot index in our hotbar (1..10) for a given weapon id,
// or -1 if not a weapon slot.
function weaponSlotOf(id) {
    const idx = WEAPON_ORDER.indexOf(id);
    return idx < 0 ? -1 : idx + 1;
}

const game = {
    scene: null, camera: null, renderer: null, clock: null,
    player: {
        pos: new THREE.Vector3(0, PLAYER_HEIGHT, 0),
        vel: new THREE.Vector3(),
        yaw: 0, pitch: 0,
        onGround: false,
        hp: MAX_HP, shield: MAX_SHIELD,
        wood: 500, kills: 0, wave: 1,
        medkits: START_MEDKITS,
        currentWeapon: 'pistol',
        weaponAmmo: makeInitialWeaponAmmo(),
        unlockedWeapons: makeInitialUnlocks(),
        reloading: false, reloadTimer: 0,
        shootCooldown: 0,
        healCd: 0,
        damageFlashTimer: 0,
        lastDamageTime: 0,
    },
    keys: {},
    mouse: { down: false, rightDown: false },
    locked: false,
    paused: true,
    running: false,
    slot: 1, // 1=pistol 2=ak 3=shotgun 4=sniper 5=medkit 6=wall 7=floor 8=ramp 9=roof
    mode: 'combat', // 'combat' | 'heal' | 'build' | 'edit'
    builds: [],       // placed structures
    enemies: [],
    bossQueue: 0,
    bullets: [],      // visual tracers
    bossProjectiles: [],
    rockets: [],      // player rocket launcher projectiles
    particles: [],
    preview: null,    // ghost preview mesh
    editing: null,    // struct being edited
    editGrid: [],     // 3x3 toggles for current edit
    editMeshes: [],
    editDragValue: null, // 0 or 1 while drag-painting cells, null when idle
    waveTimer: 0,
    spawnQueue: 0,
    raycaster: new THREE.Raycaster(),
    tmpV: new THREE.Vector3(),
    tmpV2: new THREE.Vector3(),
    tmpE: new THREE.Euler(0, 0, 0, 'YXZ'),
    worldBoxes: [],   // AABBs for collision (rebuilt when builds change)
    worldMeshes: [],  // Meshes for raycast targeting (trees, rocks)
    groundMesh: null,
    sunLight: null,
    buildCooldown: 0, // auto-build rate limiter
    state: 'lobby',   // 'lobby' | 'playing' | 'gameover'
    startPad: null,
    dummies: [],
    viewmodelHolder: null,
    viewmodelRecoil: 0,
    damageNumbers: [],
};

// === 2. SCENE SETUP ==========================================
function setupScene() {
    game.scene = new THREE.Scene();
    game.scene.background = new THREE.Color(0x87ceeb);
    game.scene.fog = new THREE.Fog(0x87ceeb, 80, 300);

    game.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 1000);
    // Camera must be in the scene so the viewmodel (a child of the camera) renders.
    game.scene.add(game.camera);
    game.viewmodelHolder = new THREE.Group();
    game.camera.add(game.viewmodelHolder);

    game.renderer = new THREE.WebGLRenderer({ antialias: true });
    game.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    game.renderer.setSize(innerWidth, innerHeight);
    game.renderer.shadowMap.enabled = true;
    game.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(game.renderer.domElement);

    // Lights
    const amb = new THREE.AmbientLight(0xffffff, 0.55);
    game.scene.add(amb);

    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(60, 100, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 300;
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    game.scene.add(sun);
    game.sunLight = sun;

    // Ground
    const groundGeo = new THREE.PlaneGeometry(400, 400, 1, 1);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a8a3a });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    game.scene.add(ground);
    game.groundMesh = ground;

    // Grid helper (subtle)
    const grid = new THREE.GridHelper(400, 100, 0x000000, 0x225522);
    grid.material.opacity = 0.25;
    grid.material.transparent = true;
    game.scene.add(grid);

    // Some decorative "trees" and rocks for scenery + cover
    for (let i = 0; i < 30; i++) {
        const x = (Math.random() - 0.5) * 300;
        const z = (Math.random() - 0.5) * 300;
        if (Math.abs(x) < 15 && Math.abs(z) < 15) continue;
        if (Math.random() < 0.5) {
            // tree
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.3, 0.4, 3, 8),
                new THREE.MeshStandardMaterial({ color: 0x5a3a1a })
            );
            trunk.position.set(x, 1.5, z);
            trunk.castShadow = true;
            game.scene.add(trunk);
            const leaves = new THREE.Mesh(
                new THREE.ConeGeometry(2, 4, 8),
                new THREE.MeshStandardMaterial({ color: 0x2a6a1a })
            );
            leaves.position.set(x, 5, z);
            leaves.castShadow = true;
            game.scene.add(leaves);
            game.worldBoxes.push(new THREE.Box3().setFromObject(trunk));
            game.worldMeshes.push(trunk, leaves);
        } else {
            // rock
            const r = 0.6 + Math.random() * 1.2;
            const rock = new THREE.Mesh(
                new THREE.DodecahedronGeometry(r, 0),
                new THREE.MeshStandardMaterial({ color: 0x888888 })
            );
            rock.position.set(x, r * 0.6, z);
            rock.castShadow = true;
            rock.receiveShadow = true;
            game.scene.add(rock);
            game.worldBoxes.push(new THREE.Box3().setFromObject(rock));
            game.worldMeshes.push(rock);
        }
    }
}

// === 3. INPUT / POINTER LOCK =================================
function setupInput() {
    const blocker = document.getElementById('blocker');
    const canvas = game.renderer.domElement;

    blocker.addEventListener('click', () => {
        if (!game.running) return;
        canvas.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
        game.locked = document.pointerLockElement === canvas;
        game.paused = !game.locked;
        blocker.classList.toggle('hidden', game.locked);
    });

    document.addEventListener('mousemove', (e) => {
        if (!game.locked) return;
        game.player.yaw -= e.movementX * 0.0022;
        game.player.pitch -= e.movementY * 0.0022;
        const lim = Math.PI / 2 - 0.02;
        if (game.player.pitch > lim) game.player.pitch = lim;
        if (game.player.pitch < -lim) game.player.pitch = -lim;
    });

    document.addEventListener('keydown', (e) => {
        game.keys[e.code] = true;
        // N works in any state (gameplay, pause, game-over) so the player can always restart.
        if (e.code === 'KeyN') { restart(); return; }
        if (!game.locked) return;
        if (e.code === 'Digit1') selectSlot(1);
        else if (e.code === 'Digit2') selectSlot(2);
        else if (e.code === 'Digit3') selectSlot(3);
        else if (e.code === 'Digit4') selectSlot(4);
        else if (e.code === 'Digit5') selectSlot(5);
        else if (e.code === 'Digit6') selectSlot(6);
        else if (e.code === 'Digit7') selectSlot(7);
        else if (e.code === 'Digit8') selectSlot(8);
        else if (e.code === 'Digit9') selectSlot(9);
        else if (e.code === 'Digit0') selectSlot(10);
        else if (e.code === 'KeyR') startReload();
        else if (e.code === 'KeyG') toggleEditMode();
    });
    document.addEventListener('keyup', (e) => { game.keys[e.code] = false; });

    document.addEventListener('mousedown', (e) => {
        if (!game.locked) return;
        if (e.button === 0) { game.mouse.down = true; handleClick(); }
        if (e.button === 2) game.mouse.rightDown = true;
    });
    document.addEventListener('mouseup', (e) => {
        if (e.button === 0) {
            game.mouse.down = false;
            game.editDragValue = null;
        }
        if (e.button === 2) game.mouse.rightDown = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // Mouse wheel cycles through the hotbar. Scrolling down advances, up
    // retreats. Locked weapon slots are skipped so cycling never strands you
    // on an unusable slot.
    document.addEventListener('wheel', (e) => {
        if (!game.locked) return;
        e.preventDefault();
        const dir = e.deltaY > 0 ? 1 : -1;
        let next = game.slot;
        // Try up to 10 steps to find a usable slot.
        for (let i = 0; i < 10; i++) {
            next += dir;
            if (next > 10) next = 1;
            if (next < 1) next = 10;
            if (next >= 1 && next <= 6) {
                const id = WEAPON_ORDER[next - 1];
                if (game.player.unlockedWeapons[id]) break;
                continue; // locked → keep scanning
            }
            break; // medkit or build slot → always selectable
        }
        if (next !== game.slot) selectSlot(next);
    }, { passive: false });

    window.addEventListener('resize', () => {
        game.camera.aspect = innerWidth / innerHeight;
        game.camera.updateProjectionMatrix();
        game.renderer.setSize(innerWidth, innerHeight);
    });
}

function selectSlot(n) {
    // Slots 1..6: weapons, 7: medkit, 8..10: builds (wall, floor, ramp).
    if (n >= 1 && n <= 6) {
        const id = WEAPON_ORDER[n - 1];
        if (!game.player.unlockedWeapons[id]) {
            showMessage(WEAPONS[id].name + ' GESPERRT — besiege den nächsten Boss', 1400);
            return; // keep current slot
        }
        game.slot = n;
        game.mode = 'combat';
        game.player.currentWeapon = id;
        game.player.reloading = false;
        game.player.reloadTimer = 0;
        game.player.shootCooldown = 0.05;
    } else if (n === 7) {
        game.slot = n;
        game.mode = 'heal';
    } else if (n >= 8 && n <= 10) {
        game.slot = n;
        game.mode = 'build';
    } else {
        return;
    }
    if (game.editing) cancelEdit();
    updateSlotHud();
    updateModeHud();
    updatePreview();
    updateViewmodel();
    updateHudCounters();
}

// === 4. COLLISION ============================================
function playerAABB(pos) {
    return new THREE.Box3(
        new THREE.Vector3(pos.x - PLAYER_RADIUS, pos.y - PLAYER_HEIGHT, pos.z - PLAYER_RADIUS),
        new THREE.Vector3(pos.x + PLAYER_RADIUS, pos.y + 0.2, pos.z + PLAYER_RADIUS)
    );
}
const STEP_HEIGHT = 1.3; // player can step up this much in one frame (onto ramps)

// Collision against everything EXCEPT ramps. Ramps are handled via a surface-ride
// so the player can walk up them instead of being blocked like a wall.
function collidesAt(pos) {
    const box = playerAABB(pos);
    for (const b of game.builds) {
        if (b.type === 'ramp') continue;
        if (!b.box.intersectsBox(box)) continue;
        if (b.tileBoxes && b.tileBoxes.length) {
            let hit = false;
            for (const tb of b.tileBoxes) if (tb.intersectsBox(box)) { hit = true; break; }
            if (hit) return true;
        } else {
            return true;
        }
    }
    for (const wb of game.worldBoxes) {
        if (wb.intersectsBox(box)) return true;
    }
    return false;
}

// Returns the world Y of the ramp SURFACE at (worldX, worldZ), or null if
// outside any ramp's footprint. Transforms to the ramp's local frame and uses
// the slope formula: local surface y = local x (see makeBuildMesh shape).
function rampSurfaceY(rs, worldX, worldZ) {
    const dx = worldX - rs.x;
    const dz = worldZ - rs.z;
    const c = Math.cos(rs.rotY);
    const s = Math.sin(rs.rotY);
    // Inverse of three.js Y-rotation: local = M^-1 * world
    const lx =  c * dx - s * dz;
    const lz =  s * dx + c * dz;
    const HALF = GRID / 2 - 0.02;
    if (lx < -HALF || lx > HALF) return null;
    if (lz < -HALF || lz > HALF) return null;
    // Local slope: at lx=-HALF world y = rs.y - GRID/2 (base), at lx=+HALF y = rs.y + GRID/2 (top)
    return rs.y + lx;
}

// Find the highest ramp surface the player could stand on at (x, z), considering
// only ramps where the player is near enough to actually be "on" the slope.
function getRampStandingY(x, z, feetY) {
    let best = null;
    for (const b of game.builds) {
        if (b.type !== 'ramp') continue;
        const sy = rampSurfaceY(b, x, z);
        if (sy === null) continue;
        // Ignore ramps where the player is clearly above and already in the air.
        if (feetY > sy + 0.5) continue;
        if (best === null || sy > best) best = sy;
    }
    return best;
}

// === 5. PLAYER UPDATE ========================================
// Try to move one axis. If blocked by a wall: fail. If stepping onto a ramp
// would lift the player less than STEP_HEIGHT, allow the move and snap Y up.
function tryAxisMove(p, axis, delta) {
    const test = p.pos.clone();
    test[axis] += delta;

    if (collidesAt(test)) return false;

    const feetY = test.y - PLAYER_HEIGHT;
    const rampY = getRampStandingY(test.x, test.z, feetY);
    if (rampY !== null) {
        const lift = rampY - feetY;
        if (lift > STEP_HEIGHT) return false;       // ramp surface too high — treat as wall
        if (lift > 0) {
            test.y = rampY + PLAYER_HEIGHT;
            // Re-check that lifted position isn't inside a wall above the ramp.
            if (collidesAt(test)) return false;
            p.vel.y = 0;
            p.onGround = true;
        }
    }

    p.pos.copy(test);
    return true;
}

function updatePlayer(dt) {
    const p = game.player;

    // desired horizontal velocity
    const forward = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const right   = new THREE.Vector3( Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    let mx = 0, mz = 0;
    if (game.keys['KeyW']) mz += 1;
    if (game.keys['KeyS']) mz -= 1;
    if (game.keys['KeyD']) mx += 1;
    if (game.keys['KeyA']) mx -= 1;
    const dir = new THREE.Vector3().addScaledVector(forward, mz).addScaledVector(right, mx);
    if (dir.lengthSq() > 0) dir.normalize();
    const speed = MOVE_SPEED * (game.keys['ShiftLeft'] || game.keys['ShiftRight'] ? SPRINT_MUL : 1);
    p.vel.x = dir.x * speed;
    p.vel.z = dir.z * speed;

    // gravity & jump
    p.vel.y -= GRAVITY * dt;
    if (p.onGround && game.keys['Space']) { p.vel.y = JUMP_V; p.onGround = false; }

    // Horizontal move with axis separation + ramp step-up.
    if (!tryAxisMove(p, 'x', p.vel.x * dt)) p.vel.x = 0;
    if (!tryAxisMove(p, 'z', p.vel.z * dt)) p.vel.z = 0;

    // Vertical move
    const next = p.pos.clone();
    next.y += p.vel.y * dt;
    if (next.y < PLAYER_HEIGHT) { next.y = PLAYER_HEIGHT; p.vel.y = 0; p.onGround = true; }
    else p.onGround = false;
    if (collidesAt(next)) {
        if (p.vel.y > 0) { next.y = p.pos.y; p.vel.y = 0; }              // ceiling
        else             { next.y = p.pos.y; p.vel.y = 0; p.onGround = true; } // floor/wall top
    }
    p.pos.copy(next);

    // Ride the ramp surface: if the player is at/below a ramp surface at their
    // XZ position, snap up so they can walk smoothly along the slope.
    const feetY = p.pos.y - PLAYER_HEIGHT;
    const rampY = getRampStandingY(p.pos.x, p.pos.z, feetY);
    if (rampY !== null && feetY <= rampY + 0.05) {
        p.pos.y = rampY + PLAYER_HEIGHT;
        if (p.vel.y < 0) p.vel.y = 0;
        p.onGround = true;
    }

    // camera
    game.camera.position.copy(p.pos);
    game.tmpE.set(p.pitch, p.yaw, 0);
    game.camera.quaternion.setFromEuler(game.tmpE);
}

// === 6. MAIN LOOP ============================================
function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(game.clock.getDelta(), 0.05); // cap for tab switch
    if (!game.paused && game.running) {
        updatePlayer(dt);
        updatePreview();
        updateAutoBuild(dt);
        updateEditDrag();
        updateBullets(dt);
        updateParticles(dt);
        updateDamageNumbers(dt);
        if (game.state === 'lobby') {
            updateLobby(dt);
        } else if (game.state === 'playing') {
            updateEnemies(dt);
            updateBossProjectiles(dt);
            updateWaves(dt);
        }
        updateRockets(dt);
        updateWeapon(dt);
        updateShieldRegen(dt);
        updateDamageFlash(dt);
    }
    game.renderer.render(game.scene, game.camera);
}

// === 7. BUILD SYSTEM ========================================
const BUILD_MAT_WALL  = new THREE.MeshStandardMaterial({ color: 0xc9a26b });
const BUILD_MAT_FLOOR = new THREE.MeshStandardMaterial({ color: 0xb08d55 });
const BUILD_MAT_RAMP  = new THREE.MeshStandardMaterial({ color: 0xa67a45 });
const BUILD_MAT_ROOF  = new THREE.MeshStandardMaterial({ color: 0x8f6a3a });
const PREVIEW_MAT_OK  = new THREE.MeshBasicMaterial({ color: 0x00ff66, transparent: true, opacity: 0.35 });
const PREVIEW_MAT_BAD = new THREE.MeshBasicMaterial({ color: 0xff3344, transparent: true, opacity: 0.35 });

function makeBuildMesh(type, damaged) {
    let mesh;
    if (type === 'wall') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(GRID, GRID, 0.25), BUILD_MAT_WALL);
    } else if (type === 'floor') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(GRID, 0.25, GRID), BUILD_MAT_FLOOR);
    } else if (type === 'ramp') {
        // Triangular prism centered at origin: base at y=-GRID/2, peak at y=GRID/2
        const shape = new THREE.Shape();
        shape.moveTo(-GRID / 2, -GRID / 2);
        shape.lineTo(GRID / 2, -GRID / 2);
        shape.lineTo(GRID / 2,  GRID / 2);
        shape.lineTo(-GRID / 2, -GRID / 2);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: GRID, bevelEnabled: false });
        geo.translate(0, 0, -GRID / 2); // center in Z
        mesh = new THREE.Mesh(geo, BUILD_MAT_RAMP);
    } else if (type === 'roof') {
        // pyramid-ish thin top
        mesh = new THREE.Mesh(new THREE.BoxGeometry(GRID, 0.5, GRID), BUILD_MAT_ROOF);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

function slotType() {
    // Slot 8 = wall, 9 = floor, 10 = ramp. (Roof dropped from hotbar to make room
    // for the new weapons — rampe is the main mobility piece anyway.)
    return ['wall','floor','ramp'][game.slot - 8] || 'wall';
}

function snap(v) { return Math.round(v / GRID) * GRID; }

function buildTargetPos(type) {
    const p = game.player;
    const feetY = p.pos.y - PLAYER_HEIGHT;
    // Current "floor level" — the integer grid level the player is standing on.
    const floorLevel = Math.floor((feetY + 0.1) / GRID);

    // Player's facing direction snapped to nearest cardinal.
    const cardYaw = Math.round(p.yaw / (Math.PI / 2)) * (Math.PI / 2);
    const fwdX = -Math.sin(cardYaw);
    const fwdZ = -Math.cos(cardYaw);

    // Player's current cell (grid-aligned).
    const pCellX = Math.round(p.pos.x / GRID) * GRID;
    const pCellZ = Math.round(p.pos.z / GRID) * GRID;

    // --- Ramps: Fortnite-style — cell one step ahead of player, base at feet. ---
    // The ramp's "front" (low end) sits at the border of the player's current
    // cell so stepping forward climbs onto the slope smoothly without teleport.
    if (type === 'ramp') {
        const rampCellX = pCellX + Math.round(fwdX) * GRID;
        const rampCellZ = pCellZ + Math.round(fwdZ) * GRID;
        // Local +X (climb direction) must map to player forward, so rotY = yaw + π/2
        const rotY = Math.round((p.yaw + Math.PI / 2) / (Math.PI / 2)) * (Math.PI / 2);
        return { x: rampCellX, y: floorLevel * GRID + GRID / 2, z: rampCellZ, rotY };
    }

    // For all other pieces, raycast to find the target cell the crosshair points at.
    const origin = p.pos.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(game.camera.quaternion).normalize();
    game.raycaster.set(origin, dir);
    game.raycaster.far = 15;

    const targets = [];
    if (game.groundMesh) targets.push(game.groundMesh);
    for (const b of game.builds) targets.push(b.mesh);
    for (const w of game.worldMeshes) targets.push(w);
    const hits = game.raycaster.intersectObjects(targets, true);

    let hp;
    if (hits.length) {
        hp = hits[0].point.clone();
        hp.add(dir.clone().multiplyScalar(0.01));
    } else {
        hp = origin.clone().add(dir.clone().multiplyScalar(7));
    }

    const cellX = Math.round(hp.x / GRID) * GRID;
    const cellZ = Math.round(hp.z / GRID) * GRID;

    if (type === 'floor') {
        // Floor level comes from where the crosshair is pointing so you can
        // stack floors by looking up at a wall's top, etc.
        const k = Math.round(hp.y / GRID);
        return { x: cellX, y: k * GRID - 0.125, z: cellZ, rotY: 0 };
    }

    if (type === 'wall') {
        // Wall always lives at the PLAYER'S floor level (matches Fortnite —
        // you can't accidentally place a wall one story above while looking up).
        const wy = floorLevel * GRID + GRID / 2;
        // Pick the edge of the target cell that's on the PLAYER'S side so the
        // wall sits between the player and whatever they're looking at.
        const dx = p.pos.x - cellX;
        const dz = p.pos.z - cellZ;
        if (Math.abs(dx) < 0.1 && Math.abs(dz) < 0.1) {
            // Player is standing in the target cell → use facing direction.
            if (Math.abs(fwdX) > Math.abs(fwdZ)) {
                const sign = fwdX > 0 ? 1 : -1;
                return { x: cellX + sign * GRID / 2, y: wy, z: cellZ, rotY: Math.PI / 2 };
            } else {
                const sign = fwdZ > 0 ? 1 : -1;
                return { x: cellX, y: wy, z: cellZ + sign * GRID / 2, rotY: 0 };
            }
        }
        if (Math.abs(dx) >= Math.abs(dz)) {
            const sign = dx >= 0 ? 1 : -1;
            return { x: cellX + sign * GRID / 2, y: wy, z: cellZ, rotY: Math.PI / 2 };
        } else {
            const sign = dz >= 0 ? 1 : -1;
            return { x: cellX, y: wy, z: cellZ + sign * GRID / 2, rotY: 0 };
        }
    }

    // roof
    const k = Math.round(hp.y / GRID) + 1;
    return { x: cellX, y: k * GRID - 0.25, z: cellZ, rotY: 0 };
}

function structureBox(type, x, y, z, rotY) {
    // Slight shrink so adjacent grid-aligned pieces don't register as overlapping.
    const EPS = 0.02;
    let hx, hy, hz;
    if (type === 'wall') {
        // Use a bigger epsilon on the LENGTH axis so two perpendicular walls meeting at a
        // shared grid corner don't mutually block each other.
        hx = GRID / 2 - 0.18;
        hy = GRID / 2 - EPS;
        hz = 0.11;
    }
    else if (type === 'floor') { hx = GRID/2 - EPS; hy = 0.13;          hz = GRID/2 - EPS; }
    else if (type === 'ramp')  { hx = GRID/2 - EPS; hy = GRID/2 - EPS;  hz = GRID/2 - EPS; }
    else                        { hx = GRID/2 - EPS; hy = 0.25;          hz = GRID/2 - EPS; }
    // rotate half-extents for wall (depth axis swap)
    if (type === 'wall' && Math.abs(Math.sin(rotY)) > 0.5) { const t = hx; hx = hz; hz = t; }
    return new THREE.Box3(
        new THREE.Vector3(x - hx, y - hy, z - hz),
        new THREE.Vector3(x + hx, y + hy, z + hz)
    );
}

function canPlace(type, x, y, z, rotY) {
    const box = structureBox(type, x, y, z, rotY);
    // not inside player
    if (box.intersectsBox(playerAABB(game.player.pos))) return false;
    // not overlapping existing builds
    for (const b of game.builds) if (b.box.intersectsBox(box)) return false;
    // not inside world obstacles (light check)
    for (const wb of game.worldBoxes) if (wb.intersectsBox(box)) return false;
    // not below ground
    if (y < 0) return false;
    return true;
}

function updatePreview() {
    // hide preview when not in build mode
    if (game.mode !== 'build') {
        if (game.preview) { game.preview.visible = false; }
        return;
    }
    const type = slotType();
    if (!game.preview || game.preview.userData.type !== type) {
        if (game.preview) game.scene.remove(game.preview);
        game.preview = makeBuildMesh(type);
        game.preview.material = PREVIEW_MAT_OK;
        game.preview.userData.type = type;
        game.preview.castShadow = false;
        game.preview.receiveShadow = false;
        game.scene.add(game.preview);
    }
    game.preview.visible = true;
    const t = buildTargetPos(type);
    game.preview.position.set(t.x, t.y, t.z);
    game.preview.rotation.y = t.rotY;
    const ok = canPlace(type, t.x, t.y, t.z, t.rotY) && game.player.wood >= BUILD_COST;
    game.preview.material = ok ? PREVIEW_MAT_OK : PREVIEW_MAT_BAD;
    game.preview.userData.okToPlace = ok;
}

function placeBuild() {
    const type = slotType();
    const t = buildTargetPos(type);
    if (!canPlace(type, t.x, t.y, t.z, t.rotY)) return false;
    if (game.player.wood < BUILD_COST) { showMessage('Zu wenig Holz!'); return false; }
    game.player.wood -= BUILD_COST;
    const mesh = makeBuildMesh(type);
    mesh.position.set(t.x, t.y, t.z);
    mesh.rotation.y = t.rotY;
    game.scene.add(mesh);
    const struct = {
        type, mesh, hp: BUILD_HP,
        x: t.x, y: t.y, z: t.z, rotY: t.rotY,
        box: structureBox(type, t.x, t.y, t.z, t.rotY),
        tiles: null, // used by edit system
    };
    game.builds.push(struct);
    updateHudCounters();
    return true;
}

function updateAutoBuild(dt) {
    if (game.buildCooldown > 0) game.buildCooldown -= dt;
    if (game.mode !== 'build') return;
    if (!game.mouse.down) return;
    if (game.buildCooldown > 0) return;
    if (placeBuild()) {
        game.buildCooldown = 0.12; // ~8 placements / sec while holding
    } else {
        // Placement blocked (overlap / out of wood): slow retry so we don't spam canPlace
        game.buildCooldown = 0.08;
    }
}

// === Stubs (filled by later sections) =======================
// === 9. WEAPON / SHOOTING ====================================
function shoot() {
    const p = game.player;
    if (p.shootCooldown > 0) return;
    if (p.reloading) return;
    const w = WEAPONS[p.currentWeapon];
    const ammo = p.weaponAmmo[p.currentWeapon];
    if (!w || !ammo) return;
    if (ammo.clip <= 0) { startReload(); return; }

    ammo.clip--;
    p.shootCooldown = w.cd;
    if (ammo.clip === 0 && ammo.reserve > 0) startReload();

    const origin = p.pos.clone();
    const baseDir = new THREE.Vector3(0, 0, -1).applyQuaternion(game.camera.quaternion).normalize();

    // Projectile weapons (rocket launcher): skip the raycast pellet loop and
    // launch a physics rocket instead.
    if (w.projectile) {
        spawnRocket(origin, baseDir, w);
        spawnMuzzleFlash(origin, baseDir);
        game.viewmodelRecoil = Math.min(0.3, game.viewmodelRecoil + 0.18);
        updateHudCounters();
        return;
    }

    // Collect candidate targets. Enemies are represented by their invisible
    // HITBOX child mesh (bigger than the visual) so aiming is forgiving.
    const targets = [];
    for (const e of game.enemies) if (e.hitbox) targets.push(e.hitbox);
    for (const d of game.dummies) targets.push(d.hitbox);
    for (const b of game.builds) targets.push(b.mesh);

    // Accumulate damage per target so shotgun pellets show one combined number.
    const shotSummary = new Map(); // target → { amount, pos, head }

    for (let i = 0; i < w.pellets; i++) {
        const dir = baseDir.clone();
        if (w.spread > 0) {
            dir.x += (Math.random() - 0.5) * 2 * w.spread;
            dir.y += (Math.random() - 0.5) * 2 * w.spread;
            dir.z += (Math.random() - 0.5) * 2 * w.spread;
            dir.normalize();
        }
        game.raycaster.set(origin, dir);
        game.raycaster.far = w.range;
        const hits = game.raycaster.intersectObjects(targets, true);

        let endPoint;
        if (hits.length) {
            endPoint = hits[0].point.clone();
            const obj = hits[0].object;
            if (obj.userData && obj.userData.isHitbox && obj.userData.enemy) {
                const e = obj.userData.enemy;
                // Headshot: hit point's Y is above a threshold relative to mesh center.
                const headThreshold = e.isBoss ? 0.7 : 0.55;
                const headshot = (endPoint.y - e.pos.y) > headThreshold;
                const mult = headshot ? (e.isBoss ? HEADSHOT_MULT_BOSS : HEADSHOT_MULT_ENEMY) : 1;
                const dealt = w.dmg * mult;
                damageEnemy(e, dealt);
                accumulateDamage(shotSummary, e, dealt, endPoint, headshot);
                flashHitMarker(headshot);
            } else if (obj.userData && obj.userData.isDummy) {
                const d = obj.userData.dummy;
                const headshot = (endPoint.y - d.mesh.position.y) > 0.55;
                const mult = headshot ? HEADSHOT_MULT_DUMMY : 1;
                const dealt = w.dmg * mult;
                damageDummy(d, dealt);
                accumulateDamage(shotSummary, d, dealt, endPoint, headshot);
                flashHitMarker(headshot);
            } else {
                // Must be a build (or child of a build group)
                let owner = obj;
                while (owner) {
                    const bb = game.builds.find(bu => bu.mesh === owner);
                    if (bb) { damageBuild(bb, w.dmg); break; }
                    owner = owner.parent;
                }
            }
            spawnImpact(endPoint);
        } else {
            endPoint = origin.clone().add(dir.clone().multiplyScalar(w.range));
        }
        spawnTracer(origin.clone().add(dir.clone().multiplyScalar(0.6)), endPoint, w.tracerColor);
    }

    // Emit one damage number per target this shot (combined).
    for (const info of shotSummary.values()) {
        spawnDamageNumber(info.pos, info.amount, info.head);
    }
    spawnMuzzleFlash(origin, baseDir);
    game.viewmodelRecoil = Math.min(0.15, game.viewmodelRecoil + 0.08);
    updateHudCounters();
}

function damageBuild(b, dmg) {
    b.hp -= dmg;
    if (b.hp <= 0) destroyBuild(b);
}

function destroyBuild(b) {
    game.scene.remove(b.mesh);
    const i = game.builds.indexOf(b);
    if (i >= 0) game.builds.splice(i, 1);
}

function startReload() {
    const p = game.player;
    if (p.reloading) return;
    const w = WEAPONS[p.currentWeapon];
    const ammo = p.weaponAmmo[p.currentWeapon];
    if (!w || !ammo) return;
    if (ammo.clip >= w.clip) return;
    if (ammo.reserve <= 0) { showMessage('Keine Munition!'); return; }
    p.reloading = true;
    p.reloadTimer = w.reload;
    showMessage('Nachladen...', w.reload * 1000);
}

function updateWeapon(dt) {
    const p = game.player;
    if (p.shootCooldown > 0) p.shootCooldown -= dt;
    if (p.healCd > 0) p.healCd -= dt;

    // Viewmodel recoil: push backward along Z when firing, then ease back.
    if (game.viewmodelHolder) {
        game.viewmodelRecoil *= Math.max(0, 1 - dt * 12);
        const vm = game.viewmodelHolder.children[0];
        if (vm) {
            vm.position.z = -0.45 + game.viewmodelRecoil;
            vm.rotation.x = game.viewmodelRecoil * 1.2;
        }
    }

    if (p.reloading) {
        p.reloadTimer -= dt;
        if (p.reloadTimer <= 0) {
            const w = WEAPONS[p.currentWeapon];
            const ammo = p.weaponAmmo[p.currentWeapon];
            if (w && ammo) {
                const need = w.clip - ammo.clip;
                const take = Math.min(need, ammo.reserve);
                ammo.clip += take;
                ammo.reserve -= take;
            }
            p.reloading = false;
            updateHudCounters();
        }
    }

    // Full-auto fire while holding LMB on auto weapons (AK)
    const w = WEAPONS[p.currentWeapon];
    if (w && w.auto && game.mouse.down && game.mode === 'combat'
        && !p.reloading && p.shootCooldown <= 0) {
        shoot();
    }
}

// === ROCKETS (player rocket launcher) ========================
function spawnRocket(origin, dir, w) {
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.7, 10),
        new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.6, roughness: 0.5 })
    );
    const tip = new THREE.Mesh(
        new THREE.ConeGeometry(0.1, 0.2, 10),
        new THREE.MeshStandardMaterial({ color: 0xff4422 })
    );
    tip.position.y = 0.45;
    body.add(tip);
    // Align cylinder (local Y) to the fire direction
    body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    body.position.copy(origin).add(dir.clone().multiplyScalar(0.8));

    // Trail light
    const light = new THREE.PointLight(0xff7733, 2.5, 8);
    body.add(light);

    game.scene.add(body);
    game.rockets.push({
        mesh: body,
        pos: body.position,
        dir: dir.clone().normalize(),
        speed: w.rocketSpeed || 38,
        life: 4.0,
        dmg: w.dmg,
        splash: w.splashRadius || 6.0,
    });
}

function updateRockets(dt) {
    for (let i = game.rockets.length - 1; i >= 0; i--) {
        const r = game.rockets[i];
        r.life -= dt;
        const step = r.dir.clone().multiplyScalar(r.speed * dt);
        r.pos.add(step);

        let hit = false;

        // Collide with enemies (direct hit). e.pos is the body group origin,
        // which sits at body vertical center, so we hit-test against that.
        for (const e of game.enemies) {
            if (e.dead) continue;
            const dx = r.pos.x - e.pos.x;
            const dy = r.pos.y - e.pos.y;
            const dz = r.pos.z - e.pos.z;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            if (dist < (e.radius || 0.6) + 0.6) { hit = true; break; }
        }
        // Direct hit on lobby dummies too
        if (!hit) {
            for (const d of game.dummies) {
                if (d.dead) continue;
                const dx = r.pos.x - d.mesh.position.x;
                const dy = r.pos.y - d.mesh.position.y;
                const dz = r.pos.z - d.mesh.position.z;
                if (dx*dx + dy*dy + dz*dz < 1.1 * 1.1) { hit = true; break; }
            }
        }

        // Collide with builds
        if (!hit) {
            const pbox = new THREE.Box3(
                new THREE.Vector3(r.pos.x - 0.35, r.pos.y - 0.35, r.pos.z - 0.35),
                new THREE.Vector3(r.pos.x + 0.35, r.pos.y + 0.35, r.pos.z + 0.35)
            );
            for (const b of game.builds) {
                if (!b.box.intersectsBox(pbox)) continue;
                if (b.tileBoxes && b.tileBoxes.length) {
                    for (const tb of b.tileBoxes) if (tb.intersectsBox(pbox)) { hit = true; break; }
                } else hit = true;
                if (hit) break;
            }
        }

        // Ground hit
        if (!hit && r.pos.y <= 0) hit = true;

        if (hit || r.life <= 0) {
            explodeRocket(r);
            game.scene.remove(r.mesh);
            game.rockets.splice(i, 1);
        }
    }
}

function explodeRocket(r) {
    const pos = r.pos.clone();
    const radius = r.splash;

    // Splash damage to every enemy in range, with quadratic falloff.
    for (const e of game.enemies) {
        if (e.dead) continue;
        const dx = pos.x - e.pos.x;
        const dy = pos.y - e.pos.y;
        const dz = pos.z - e.pos.z;
        const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (d > radius) continue;
        const fall = 1 - (d / radius);
        const dmg = Math.max(20, r.dmg * fall * fall);
        damageEnemy(e, dmg);
        // Spawn a combined damage number above the enemy head
        const numPos = new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z);
        spawnDamageNumber(numPos, dmg, false);
    }

    // Splash damage on dummies (so rockets work at the practice range)
    for (const d of game.dummies) {
        if (d.dead) continue;
        const dx = pos.x - d.mesh.position.x;
        const dy = pos.y - d.mesh.position.y;
        const dz = pos.z - d.mesh.position.z;
        const dd = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (dd > radius) continue;
        const fall = 1 - (dd / radius);
        damageDummy(d, Math.max(20, r.dmg * fall * fall));
    }

    // Damage nearby builds too (destroys walls)
    for (let i = game.builds.length - 1; i >= 0; i--) {
        const b = game.builds[i];
        const cx = (b.box.min.x + b.box.max.x) / 2;
        const cy = (b.box.min.y + b.box.max.y) / 2;
        const cz = (b.box.min.z + b.box.max.z) / 2;
        const d = Math.sqrt((pos.x-cx)**2 + (pos.y-cy)**2 + (pos.z-cz)**2);
        if (d > radius) continue;
        const fall = 1 - (d / radius);
        damageBuild(b, r.dmg * fall * 0.8);
    }

    // Self-damage if player is too close (but reduced — rocket jumping possible).
    const pdx = pos.x - game.player.pos.x;
    const pdy = pos.y - (game.player.pos.y - PLAYER_HEIGHT / 2);
    const pdz = pos.z - game.player.pos.z;
    const pdist = Math.sqrt(pdx*pdx + pdy*pdy + pdz*pdz);
    if (pdist < radius * 0.75) {
        const fall = 1 - (pdist / (radius * 0.75));
        damagePlayer(Math.floor(r.dmg * fall * 0.2));
    }

    spawnExplosion(pos, radius);
}

function spawnExplosion(pos, radius) {
    // Flash point light
    const light = new THREE.PointLight(0xffaa44, 8, radius * 3);
    light.position.copy(pos);
    game.scene.add(light);
    game.particles.push({ obj: light, life: 0.35, type: 'flash' });

    // Many orange sparks flying outward
    for (let i = 0; i < 40; i++) {
        const s = new THREE.Mesh(
            new THREE.SphereGeometry(0.12, 4, 4),
            new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? 0xff6622 : 0xffcc33 })
        );
        s.position.copy(pos);
        const v = new THREE.Vector3(
            (Math.random() - 0.5) * 22,
            Math.random() * 16,
            (Math.random() - 0.5) * 22
        );
        game.scene.add(s);
        game.particles.push({ obj: s, vel: v, life: 0.9, type: 'spark' });
    }
    // Central fireball sphere that fades
    const ball = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.35, 14, 14),
        new THREE.MeshBasicMaterial({ color: 0xffaa22, transparent: true, opacity: 0.85 })
    );
    ball.position.copy(pos);
    game.scene.add(ball);
    game.particles.push({ obj: ball, life: 0.4, type: 'fireball' });
}

function spawnTracer(from, to, color = 0xffff66) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    line.userData.life = 0.08;
    game.scene.add(line);
    game.bullets.push(line);
}

// === VIEWMODEL (first-person weapon held in hand) ============
function makeWeaponViewmodel(id) {
    const g = new THREE.Group();

    if (id === 'pistol') {
        const slide = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.1, 0.28),
            new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.4 })
        );
        slide.position.set(0, 0, -0.1);
        g.add(slide);
        const grip = new THREE.Mesh(
            new THREE.BoxGeometry(0.07, 0.18, 0.1),
            new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 })
        );
        grip.position.set(0, -0.12, 0.05);
        g.add(grip);
        const barrel = new THREE.Mesh(
            new THREE.CylinderGeometry(0.015, 0.015, 0.08, 8),
            new THREE.MeshStandardMaterial({ color: 0x000000 })
        );
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.01, -0.28);
        g.add(barrel);
    }
    else if (id === 'ak') {
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.1, 0.55),
            new THREE.MeshStandardMaterial({ color: 0x3a2510, metalness: 0.2, roughness: 0.7 })
        );
        body.position.set(0, 0, -0.2);
        g.add(body);
        const stock = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.11, 0.22),
            new THREE.MeshStandardMaterial({ color: 0x4a321a })
        );
        stock.position.set(0, -0.01, 0.18);
        g.add(stock);
        const mag = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.16, 0.09),
            new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
        );
        mag.position.set(0, -0.12, -0.1);
        g.add(mag);
        const barrel = new THREE.Mesh(
            new THREE.CylinderGeometry(0.018, 0.018, 0.2, 8),
            new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.7 })
        );
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.03, -0.55);
        g.add(barrel);
        const grip = new THREE.Mesh(
            new THREE.BoxGeometry(0.05, 0.14, 0.05),
            new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
        );
        grip.position.set(0, -0.12, 0.05);
        g.add(grip);
    }
    else if (id === 'shotgun') {
        const stock = new THREE.Mesh(
            new THREE.BoxGeometry(0.09, 0.13, 0.28),
            new THREE.MeshStandardMaterial({ color: 0x5a3a15, roughness: 0.9 })
        );
        stock.position.set(0, -0.02, 0.18);
        g.add(stock);
        const receiver = new THREE.Mesh(
            new THREE.BoxGeometry(0.09, 0.1, 0.22),
            new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5 })
        );
        receiver.position.set(0, 0.0, -0.06);
        g.add(receiver);
        const barrel = new THREE.Mesh(
            new THREE.CylinderGeometry(0.034, 0.034, 0.55, 14),
            new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.7 })
        );
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.03, -0.44);
        g.add(barrel);
        const pump = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.06, 0.14),
            new THREE.MeshStandardMaterial({ color: 0x3a2510 })
        );
        pump.position.set(0, -0.06, -0.3);
        g.add(pump);
    }
    else if (id === 'sniper') {
        const stock = new THREE.Mesh(
            new THREE.BoxGeometry(0.07, 0.1, 0.3),
            new THREE.MeshStandardMaterial({ color: 0x2a1a0a })
        );
        stock.position.set(0, -0.04, 0.2);
        g.add(stock);
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(0.07, 0.08, 0.3),
            new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.5 })
        );
        body.position.set(0, 0, -0.08);
        g.add(body);
        const barrel = new THREE.Mesh(
            new THREE.CylinderGeometry(0.018, 0.018, 0.7, 10),
            new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.8 })
        );
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.02, -0.52);
        g.add(barrel);
        const scope = new THREE.Mesh(
            new THREE.CylinderGeometry(0.035, 0.035, 0.2, 12),
            new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9 })
        );
        scope.rotation.x = Math.PI / 2;
        scope.position.set(0, 0.07, -0.1);
        g.add(scope);
        const scopeLens = new THREE.Mesh(
            new THREE.CircleGeometry(0.028, 12),
            new THREE.MeshBasicMaterial({ color: 0x88ddff })
        );
        scopeLens.position.set(0, 0.07, -0.005);
        g.add(scopeLens);
    }
    else if (id === 'medkit') {
        const box = new THREE.Mesh(
            new THREE.BoxGeometry(0.26, 0.2, 0.16),
            new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })
        );
        g.add(box);
        const cross1 = new THREE.Mesh(
            new THREE.BoxGeometry(0.16, 0.05, 0.005),
            new THREE.MeshBasicMaterial({ color: 0xdd0000 })
        );
        cross1.position.set(0, 0, 0.085);
        g.add(cross1);
        const cross2 = new THREE.Mesh(
            new THREE.BoxGeometry(0.05, 0.16, 0.005),
            new THREE.MeshBasicMaterial({ color: 0xdd0000 })
        );
        cross2.position.set(0, 0, 0.085);
        g.add(cross2);
    }

    // Anchor the viewmodel at the lower-right of the screen, slightly in front.
    g.position.set(0.24, -0.22, -0.45);
    g.rotation.y = -0.08;
    // Viewmodels shouldn't cast shadows (they're at the camera origin).
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    return g;
}

function updateViewmodel() {
    if (!game.viewmodelHolder) return;
    while (game.viewmodelHolder.children.length > 0) {
        game.viewmodelHolder.remove(game.viewmodelHolder.children[0]);
    }
    let id = null;
    if (game.mode === 'combat') id = game.player.currentWeapon;
    else if (game.mode === 'heal') id = 'medkit';
    if (id) game.viewmodelHolder.add(makeWeaponViewmodel(id));
}

function useMedkit() {
    const p = game.player;
    if (p.healCd > 0) return;
    if (p.medkits <= 0) { showMessage('Kein Medkit!', 800); return; }
    if (p.hp >= MAX_HP) { showMessage('HP voll', 600); return; }
    p.medkits--;
    const healed = Math.min(HEAL_AMOUNT, MAX_HP - p.hp);
    p.hp += healed;
    p.healCd = 0.6;
    showMessage('+' + healed + ' HP', 800);
    updateHudCounters();
}

function spawnMuzzleFlash(origin, dir) {
    const flash = new THREE.PointLight(0xffcc55, 4, 8);
    flash.position.copy(origin).add(dir.clone().multiplyScalar(0.4));
    flash.userData.life = 0.06;
    game.scene.add(flash);
    game.particles.push({ obj: flash, life: 0.06, type: 'flash' });
}

function spawnImpact(point) {
    for (let i = 0; i < 6; i++) {
        const s = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 4, 4),
            new THREE.MeshBasicMaterial({ color: 0xffaa33 })
        );
        s.position.copy(point);
        const v = new THREE.Vector3(
            (Math.random() - 0.5) * 4,
            Math.random() * 3,
            (Math.random() - 0.5) * 4
        );
        game.scene.add(s);
        game.particles.push({ obj: s, vel: v, life: 0.4, type: 'spark' });
    }
}

function updateBullets(dt) {
    for (let i = game.bullets.length - 1; i >= 0; i--) {
        const b = game.bullets[i];
        b.userData.life -= dt;
        b.material.opacity = Math.max(0, b.userData.life / 0.08) * 0.9;
        if (b.userData.life <= 0) {
            game.scene.remove(b);
            game.bullets.splice(i, 1);
        }
    }
}

function updateParticles(dt) {
    for (let i = game.particles.length - 1; i >= 0; i--) {
        const p = game.particles[i];
        p.life -= dt;
        if (p.type === 'spark' && p.vel) {
            p.vel.y -= 9 * dt;
            p.obj.position.addScaledVector(p.vel, dt);
        }
        if (p.type === 'flash') {
            p.obj.intensity *= 0.5;
        }
        if (p.type === 'fireball') {
            // Grow and fade the fireball sphere
            const s = 1 + (1 - p.life / 0.4) * 1.2;
            p.obj.scale.set(s, s, s);
            if (p.obj.material) p.obj.material.opacity = Math.max(0, p.life / 0.4) * 0.85;
        }
        if (p.life <= 0) {
            game.scene.remove(p.obj);
            game.particles.splice(i, 1);
        }
    }
}
// === 10. ENEMIES, BOSSES & WAVES =============================
const ENEMY_MAT = new THREE.MeshStandardMaterial({ color: 0xa02828 });
const ENEMY_MAT_HURT = new THREE.MeshStandardMaterial({ color: 0xff8888 });
const ENEMY_HEAD_MAT = new THREE.MeshStandardMaterial({ color: 0x8a1010 });
const ENEMY_RADIUS = 0.55;
const ENEMY_ATTACK_RANGE = 1.5;
const ENEMY_ATTACK_CD = 1.0;
const WAVE_PAUSE = 3.5;
const BOSS_MAT = new THREE.MeshStandardMaterial({
    color: 0x550011, emissive: 0x330000, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.6,
});
const BOSS_MAT_HURT = new THREE.MeshStandardMaterial({
    color: 0xff3344, emissive: 0x660000, emissiveIntensity: 0.8,
});
const BOSS_HEAD_MAT = new THREE.MeshStandardMaterial({
    color: 0x330000, emissive: 0x220000, emissiveIntensity: 0.5,
});
const BOSS_RADIUS = 1.3;
const BOSS_ATTACK_RANGE = 2.8;
const BOSS_ATTACK_CD = 1.4;

// Builds a simple humanoid made of boxes: head, torso, arms, legs.
// Returns { group, bodyParts } — bodyParts is the list of meshes whose material
// gets swapped on hurt flash, excluding the eyes.
function makeEnemyBody(bodyMat, headMat) {
    const g = new THREE.Group();
    const parts = [];
    const mkPart = (geo, mat, x, y, z) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        m.userData.originalMat = mat; // for hurt-flash restoration
        g.add(m);
        parts.push(m);
        return m;
    };
    mkPart(new THREE.BoxGeometry(0.25, 0.75, 0.25), bodyMat, -0.15, -0.525, 0);     // left leg
    mkPart(new THREE.BoxGeometry(0.25, 0.75, 0.25), bodyMat,  0.15, -0.525, 0);     // right leg
    mkPart(new THREE.BoxGeometry(0.65, 0.7,  0.35), bodyMat,  0,    0.2,   0);      // torso
    mkPart(new THREE.BoxGeometry(0.2,  0.7,  0.2),  bodyMat, -0.42, 0.2,   0);      // left arm
    mkPart(new THREE.BoxGeometry(0.2,  0.7,  0.2),  bodyMat,  0.42, 0.2,   0);      // right arm
    const head = mkPart(new THREE.BoxGeometry(0.45, 0.4, 0.4), headMat, 0, 0.75, 0);
    // Eyes on the head front (local -Z). Not in `parts` so they keep glowing.
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.02), eyeMat);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.02), eyeMat);
    eyeL.position.set(-0.1, 0.02, -0.21);
    eyeR.position.set( 0.1, 0.02, -0.21);
    head.add(eyeL); head.add(eyeR);
    return { group: g, bodyParts: parts };
}

function makeBossBody(bodyMat, headMat) {
    const g = new THREE.Group();
    const parts = [];
    const mkPart = (geo, mat, x, y, z) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        m.userData.originalMat = mat;
        g.add(m);
        parts.push(m);
        return m;
    };
    // Beefier proportions. Local origin is at body vertical center.
    mkPart(new THREE.BoxGeometry(0.55, 1.5, 0.55), bodyMat, -0.35, -1.05, 0);  // left leg
    mkPart(new THREE.BoxGeometry(0.55, 1.5, 0.55), bodyMat,  0.35, -1.05, 0);  // right leg
    mkPart(new THREE.BoxGeometry(1.6,  1.4, 0.8),  bodyMat,  0,    0.0,   0);  // torso
    mkPart(new THREE.BoxGeometry(0.5,  1.4, 0.5),  bodyMat, -1.05, 0.0,   0);  // left arm
    mkPart(new THREE.BoxGeometry(0.5,  1.4, 0.5),  bodyMat,  1.05, 0.0,   0);  // right arm
    const head = mkPart(new THREE.BoxGeometry(0.9, 0.8, 0.8), headMat, 0, 1.1, 0);

    // Giant glowing eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffee00 });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.05), eyeMat);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.05), eyeMat);
    eyeL.position.set(-0.22, 0.05, -0.42);
    eyeR.position.set( 0.22, 0.05, -0.42);
    head.add(eyeL); head.add(eyeR);

    // Spikes on top of the head
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0x220000 });
    for (let i = -1; i <= 1; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 6), spikeMat);
        spike.position.set(i * 0.2, 0.55, 0);
        head.add(spike);
    }
    return { group: g, bodyParts: parts };
}

// === Damage numbers (floating hit text) ======================
function spawnDamageNumber(worldPos, amount, isHeadshot) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    const text = Math.round(amount).toString();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#000';
    ctx.font = isHeadshot ? 'bold 68px Arial' : 'bold 54px Arial';
    ctx.fillStyle = isHeadshot ? '#ff3366' : '#ffe055';
    ctx.strokeText(text, 128, 48);
    ctx.fillText(text, 128, 48);
    if (isHeadshot) {
        ctx.font = 'bold 22px Arial';
        ctx.lineWidth = 5;
        ctx.fillStyle = '#ff6688';
        ctx.strokeText('HEADSHOT!', 128, 86);
        ctx.fillText('HEADSHOT!', 128, 86);
    }
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 50;
    // Small random offset so overlapping numbers don't perfectly stack.
    sprite.position.set(
        worldPos.x + (Math.random() - 0.5) * 0.4,
        worldPos.y + 0.2,
        worldPos.z + (Math.random() - 0.5) * 0.4
    );
    const scale = isHeadshot ? 1.6 : 1.2;
    sprite.scale.set(scale, scale * 0.4, 1);
    game.scene.add(sprite);
    game.damageNumbers.push({
        sprite, tex, life: 1.1, velY: 1.8, isHead: isHeadshot,
    });
}

function updateDamageNumbers(dt) {
    for (let i = game.damageNumbers.length - 1; i >= 0; i--) {
        const dn = game.damageNumbers[i];
        dn.life -= dt;
        dn.sprite.position.y += dn.velY * dt;
        dn.velY = Math.max(0, dn.velY - dt * 0.5);
        dn.sprite.material.opacity = Math.max(0, dn.life / 1.1);
        if (dn.life <= 0) {
            game.scene.remove(dn.sprite);
            if (dn.tex) dn.tex.dispose();
            if (dn.sprite.material) dn.sprite.material.dispose();
            game.damageNumbers.splice(i, 1);
        }
    }
}

// === Enemy HP text sprite ====================================
function makeHpTextSprite(isBoss) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 13;
    const s = isBoss ? 2.4 : 1.2;
    sprite.scale.set(s, s * 0.25, 1);
    return { sprite, canvas, tex };
}

function updateHpText(hpt, hp, hpMax, isBoss) {
    const ctx = hpt.canvas.getContext('2d');
    ctx.clearRect(0, 0, hpt.canvas.width, hpt.canvas.height);
    ctx.font = isBoss ? 'bold 36px Arial' : 'bold 30px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#ffffff';
    const shown = Math.max(0, Math.round(hp));
    const text = shown + ' / ' + Math.round(hpMax);
    ctx.strokeText(text, 128, 32);
    ctx.fillText(text, 128, 32);
    hpt.tex.needsUpdate = true;
}

// Generous hitbox — bigger than the visual mesh so aiming is more forgiving.
// Uses an invisible material so shots still raycast-hit it but it doesn't render.
function makeHitbox(width, height, depth, enemyRef) {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshBasicMaterial({ visible: false })
    );
    mesh.userData.isHitbox = true;
    mesh.userData.enemy = enemyRef;
    return mesh;
}

function spawnEnemy(overridePos) {
    let x, z;
    if (overridePos) { x = overridePos.x; z = overridePos.z; }
    else {
        const angle = Math.random() * Math.PI * 2;
        const dist = 35 + Math.random() * 15;
        x = Math.cos(angle) * dist;
        z = Math.sin(angle) * dist;
    }
    // Build a humanoid body (head, torso, arms, legs). Each enemy clones the
    // shared material so hurt flashes don't flicker the whole group at once.
    const bodyMat = ENEMY_MAT.clone();
    const headMat = ENEMY_HEAD_MAT.clone();
    const { group: mesh, bodyParts } = makeEnemyBody(bodyMat, headMat);
    // Group origin is at body center; placing mesh.y = 0.9 puts feet at y=0.
    mesh.position.set(x, 0.9, z);

    const barBg = new THREE.Mesh(
        new THREE.PlaneGeometry(1.0, 0.12),
        new THREE.MeshBasicMaterial({ color: 0x222222, depthTest: false })
    );
    barBg.position.set(0, 1.3, 0);
    barBg.renderOrder = 10;
    mesh.add(barBg);
    const bar = new THREE.Mesh(
        new THREE.PlaneGeometry(0.96, 0.08),
        new THREE.MeshBasicMaterial({ color: 0x00ff44, depthTest: false })
    );
    bar.position.set(0, 1.3, 0.01);
    bar.renderOrder = 11;
    mesh.add(bar);
    game.scene.add(mesh);
    const hpMax = ENEMY_HP_BASE + (game.player.wave - 1) * 10;
    const e = {
        isBoss: false,
        mesh, bar, barBg,
        hitbox: null,
        pos: mesh.position,
        meshYOffset: 0.9,
        hp: hpMax, hpMax,
        attackCd: 0,
        hurtTimer: 0,
        radius: ENEMY_RADIUS,
        speed: ENEMY_SPEED,
        damage: ENEMY_DMG,
        attackRange: ENEMY_ATTACK_RANGE,
        attackCdMax: ENEMY_ATTACK_CD,
        bodyParts,
        bodyMat, headMat,
        mat: ENEMY_MAT, matHurt: ENEMY_MAT_HURT,
        shootCd: 0,
    };
    // Hitbox covers the whole humanoid, generous width for forgiving aim.
    const hb = makeHitbox(1.5, 2.1, 1.5, e);
    hb.position.set(0, 0, 0);
    mesh.add(hb);
    e.hitbox = hb;
    const hpt = makeHpTextSprite(false);
    hpt.sprite.position.set(0, 1.6, 0);
    mesh.add(hpt.sprite);
    e.hpTextData = hpt;
    updateHpText(hpt, e.hp, e.hpMax, false);
    game.enemies.push(e);
    return e;
}

function spawnBoss() {
    const angle = Math.random() * Math.PI * 2;
    const dist = 42;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const bodyMat = BOSS_MAT.clone();
    const headMat = BOSS_HEAD_MAT.clone();
    const { group: mesh, bodyParts } = makeBossBody(bodyMat, headMat);
    // Group origin is at body vertical center. Feet span local -1.8 to -0.3,
    // so pos.y = 1.8 puts feet at world y = 0.
    mesh.position.set(x, 1.8, z);

    // Boss HP bar (larger, gold)
    const barBg = new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, 0.28),
        new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false })
    );
    barBg.position.set(0, 2.4, 0);
    barBg.renderOrder = 10;
    mesh.add(barBg);
    const bar = new THREE.Mesh(
        new THREE.PlaneGeometry(3.05, 0.2),
        new THREE.MeshBasicMaterial({ color: 0xffcc00, depthTest: false })
    );
    bar.position.set(0, 2.4, 0.01);
    bar.renderOrder = 11;
    mesh.add(bar);

    game.scene.add(mesh);
    const bossTier = Math.max(1, Math.floor(game.player.wave / 5));
    const hpMax = 350 + bossTier * 200;
    const e = {
        isBoss: true,
        mesh, bar, barBg,
        hitbox: null,
        pos: mesh.position,
        meshYOffset: 1.8,
        hp: hpMax, hpMax,
        attackCd: 0,
        hurtTimer: 0,
        radius: BOSS_RADIUS,
        speed: 2.2,
        damage: 22,
        attackRange: BOSS_ATTACK_RANGE,
        attackCdMax: BOSS_ATTACK_CD,
        bodyParts,
        bodyMat, headMat,
        mat: BOSS_MAT, matHurt: BOSS_MAT_HURT,
        shootCd: 2.2,
    };
    // Generous boss hitbox: matches visual closely but slightly padded.
    const hb = makeHitbox(3.6, 4.0, 3.6, e);
    hb.position.set(0, 0, 0);
    mesh.add(hb);
    e.hitbox = hb;
    // Boss HP number above the gold bar
    const hpt = makeHpTextSprite(true);
    hpt.sprite.position.set(0, 2.85, 0);
    mesh.add(hpt.sprite);
    e.hpTextData = hpt;
    updateHpText(hpt, e.hp, e.hpMax, true);
    game.enemies.push(e);
    showMessage('BOSS ERSCHEINT!', 2500);
}

function enemyBox(e) {
    return new THREE.Box3(
        new THREE.Vector3(e.pos.x - e.radius, 0, e.pos.z - e.radius),
        new THREE.Vector3(e.pos.x + e.radius, e.meshYOffset * 2, e.pos.z + e.radius)
    );
}

function moveEnemyWithCollision(e, delta) {
    const oldX = e.pos.x, oldZ = e.pos.z;
    e.pos.x += delta.x;
    if (enemyBlocked(e)) e.pos.x = oldX;
    e.pos.z += delta.z;
    if (enemyBlocked(e)) e.pos.z = oldZ;
    e.mesh.position.set(e.pos.x, e.meshYOffset, e.pos.z);
}

function enemyBlocked(e) {
    const box = enemyBox(e);
    for (const b of game.builds) {
        if (!b.box.intersectsBox(box)) continue;
        if (b.tileBoxes && b.tileBoxes.length) {
            for (const tb of b.tileBoxes) if (tb.intersectsBox(box)) return true;
        } else return true;
    }
    for (const wb of game.worldBoxes) if (wb.intersectsBox(box)) return true;
    return false;
}

function updateEnemies(dt) {
    for (let i = game.enemies.length - 1; i >= 0; i--) {
        const e = game.enemies[i];
        const toPlayer = new THREE.Vector3(
            game.player.pos.x - e.pos.x, 0, game.player.pos.z - e.pos.z
        );
        const distXZ = toPlayer.length();
        if (distXZ > 0.01) toPlayer.multiplyScalar(1 / distXZ);
        e.mesh.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);

        if (distXZ > e.attackRange - 0.2) {
            const step = toPlayer.multiplyScalar(e.speed * dt);
            moveEnemyWithCollision(e, step);
        }

        // Melee attack
        if (e.attackCd > 0) e.attackCd -= dt;
        if (distXZ <= e.attackRange && e.attackCd <= 0) {
            e.attackCd = e.attackCdMax;
            damagePlayer(e.damage);
        }

        // Boss ranged attack: fire a projectile at the player from mid range
        if (e.isBoss) {
            e.shootCd -= dt;
            if (e.shootCd <= 0 && distXZ > 3 && distXZ < 35) {
                spawnBossProjectile(e, game.player.pos);
                e.shootCd = 2.5;
            }
        }

        // Hurt flash: swap every body part to the hurt material briefly, then
        // restore each part's original material so the head keeps its tint.
        if (e.hurtTimer > 0) {
            e.hurtTimer -= dt;
            if (e.bodyParts) {
                if (e.hurtTimer > 0) {
                    for (const part of e.bodyParts) part.material = e.matHurt;
                } else {
                    for (const part of e.bodyParts) part.material = part.userData.originalMat;
                }
            }
        }

        // Face HP bar at camera
        e.bar.lookAt(game.camera.position);
        e.barBg.lookAt(game.camera.position);
        const pct = Math.max(0, e.hp / e.hpMax);
        e.bar.scale.x = pct;
        const barFullWidth = e.isBoss ? 3.05 : 0.96;
        e.bar.position.x = -(1 - pct) * (barFullWidth / 2);
    }
}

function accumulateDamage(map, target, amount, pos, head) {
    const existing = map.get(target);
    if (existing) {
        existing.amount += amount;
        if (head) existing.head = true;
    } else {
        map.set(target, { amount, pos: pos.clone(), head });
    }
}

function damageEnemy(e, dmg) {
    if (e.dead) return;
    e.hp -= dmg;
    e.hurtTimer = 0.1;
    if (e.hpTextData) updateHpText(e.hpTextData, e.hp, e.hpMax, e.isBoss);
    if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    game.scene.remove(e.mesh);
    const i = game.enemies.indexOf(e);
    if (i >= 0) game.enemies.splice(i, 1);
    game.player.kills++;

    if (e.isBoss) {
        // Boss loot: heals, ammo for every weapon, wood
        game.player.wood += 200;
        game.player.medkits = Math.min(MAX_MEDKITS, game.player.medkits + 2);
        for (const id of WEAPON_ORDER) {
            const w = WEAPONS[id];
            const ammo = game.player.weaponAmmo[id];
            ammo.reserve = Math.min(w.max, ammo.reserve + Math.floor(w.clip * 2));
        }
        // Small HP reward too
        game.player.hp = Math.min(MAX_HP, game.player.hp + 25);
        // Weapon unlock: give the next locked weapon in the order.
        const unlocked = unlockNextWeapon();
        if (unlocked) {
            showUnlockBanner(unlocked);
        } else {
            showMessage('BOSS BESIEGT! +2 Medkit, +Munition', 2500);
        }
    } else {
        game.player.wood += 20;
        // +10 ammo to CURRENT weapon's reserve
        const w = WEAPONS[game.player.currentWeapon];
        const ammo = game.player.weaponAmmo[game.player.currentWeapon];
        if (w && ammo) ammo.reserve = Math.min(w.max, ammo.reserve + AMMO_PER_KILL);
    }
    updateHudCounters();
}

// ----- Boss projectile ----------------------------------------
function spawnBossProjectile(boss, targetPos) {
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xff3300 })
    );
    const from = boss.pos.clone(); from.y = 1.5;
    mesh.position.copy(from);
    const light = new THREE.PointLight(0xff5522, 3.0, 10);
    mesh.add(light);
    game.scene.add(mesh);

    const to = targetPos.clone();
    const dir = to.sub(from).normalize();
    game.bossProjectiles.push({
        mesh,
        pos: mesh.position,
        dir,
        speed: 20,
        life: 2.5,
        dmg: 18,
    });
}

function updateBossProjectiles(dt) {
    for (let i = game.bossProjectiles.length - 1; i >= 0; i--) {
        const pr = game.bossProjectiles[i];
        pr.life -= dt;
        const step = pr.dir.clone().multiplyScalar(pr.speed * dt);
        pr.pos.add(step);

        // Hit player?
        const dx = pr.pos.x - game.player.pos.x;
        const dy = pr.pos.y - (game.player.pos.y - PLAYER_HEIGHT / 2);
        const dz = pr.pos.z - game.player.pos.z;
        if (dx*dx + dy*dy + dz*dz < 1.0) {
            damagePlayer(pr.dmg);
            spawnImpact(pr.pos.clone());
            game.scene.remove(pr.mesh);
            game.bossProjectiles.splice(i, 1);
            continue;
        }

        // Hit a wall / build?
        const pbox = new THREE.Box3(
            new THREE.Vector3(pr.pos.x - 0.3, pr.pos.y - 0.3, pr.pos.z - 0.3),
            new THREE.Vector3(pr.pos.x + 0.3, pr.pos.y + 0.3, pr.pos.z + 0.3)
        );
        let hitBuild = false;
        for (const b of game.builds) {
            if (!b.box.intersectsBox(pbox)) continue;
            if (b.tileBoxes && b.tileBoxes.length) {
                for (const tb of b.tileBoxes) if (tb.intersectsBox(pbox)) { hitBuild = true; break; }
            } else hitBuild = true;
            if (hitBuild) break;
        }
        if (hitBuild || pr.life <= 0) {
            spawnImpact(pr.pos.clone());
            game.scene.remove(pr.mesh);
            game.bossProjectiles.splice(i, 1);
        }
    }
}

function damagePlayer(dmg) {
    const p = game.player;
    if (p.shield > 0) {
        const absorbed = Math.min(p.shield, dmg);
        p.shield -= absorbed;
        dmg -= absorbed;
    }
    p.hp -= dmg;
    p.damageFlashTimer = 0.25;
    p.lastDamageTime = performance.now();
    document.body.classList.add('damage');
    updateHudCounters();
    if (p.hp <= 0) gameOver();
}

// Halo-style: shield starts regenerating after 5 seconds of no damage taken.
function updateShieldRegen(dt) {
    const p = game.player;
    if (p.shield >= MAX_SHIELD) return;
    const since = (performance.now() - p.lastDamageTime) / 1000;
    if (since < 5) return;
    p.shield = Math.min(MAX_SHIELD, p.shield + 18 * dt);
    updateHudCounters();
}

function updateWaves(dt) {
    if (game.bossQueue > 0 || game.spawnQueue > 0) {
        game.waveTimer -= dt;
        if (game.waveTimer <= 0) {
            if (game.bossQueue > 0) {
                spawnBoss();
                game.bossQueue--;
                game.waveTimer = 1.2;
            } else {
                spawnEnemy();
                game.spawnQueue--;
                game.waveTimer = 0.6;
            }
            updateHudCounters();
        }
    } else if (game.enemies.length === 0) {
        // wave cleared — start next
        game.waveTimer -= dt;
        if (game.waveTimer <= -WAVE_PAUSE) {
            game.player.wave++;
            if (game.player.wave % 5 === 0) {
                // Boss wave: fewer grunts, one scaling boss
                game.spawnQueue = 2 + Math.floor(game.player.wave / 5);
                game.bossQueue = 1 + Math.floor(game.player.wave / 10); // wave 10: 2 bosses, wave 20: 3, ...
                showMessage('⚠ BOSS-WELLE ' + game.player.wave + ' ⚠', 2500);
            } else {
                game.spawnQueue = 3 + game.player.wave * 2;
                showMessage('Welle ' + game.player.wave, 1500);
            }
            game.waveTimer = 0.4;
            updateHudCounters();
        }
    }
}

function startWaves() {
    game.player.wave = 1;
    game.spawnQueue = 5;
    game.bossQueue = 0;
    game.waveTimer = 1.0;
    showMessage('Welle 1', 1500);
}

// === LOBBY =========================================================
const START_PAD_POS = new THREE.Vector3(0, 0.05, -30);
const START_PAD_RADIUS = 2.5;
const DUMMY_POSITIONS = [
    { x: -3, z: -8 },
    { x:  3, z: -8 },
    { x: -5, z: -15 },
    { x:  5, z: -15 },
    { x:  0, z: -22 },
];
const DUMMY_GEO  = new THREE.BoxGeometry(0.9, 1.8, 0.9);
const DUMMY_MAT  = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
const DUMMY_HURT = new THREE.MeshStandardMaterial({ color: 0xffdddd });
const DUMMY_HP   = 60;
const DUMMY_RESPAWN = 2.0;

function spawnDummy(x, z) {
    const mesh = new THREE.Mesh(DUMMY_GEO, DUMMY_MAT.clone());
    mesh.position.set(x, 0.9, z);
    mesh.castShadow = true;
    // Wooden pole under the dummy to look like a practice target
    const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 1.8, 8),
        new THREE.MeshStandardMaterial({ color: 0x6b4422 })
    );
    pole.position.set(0, -0.9, 0);
    mesh.add(pole);
    // HP bar
    const barBg = new THREE.Mesh(
        new THREE.PlaneGeometry(1.0, 0.1),
        new THREE.MeshBasicMaterial({ color: 0x222222, depthTest: false })
    );
    barBg.position.set(0, 1.3, 0);
    barBg.renderOrder = 10;
    mesh.add(barBg);
    const bar = new THREE.Mesh(
        new THREE.PlaneGeometry(0.96, 0.07),
        new THREE.MeshBasicMaterial({ color: 0xffcc00, depthTest: false })
    );
    bar.position.set(0, 1.3, 0.01);
    bar.renderOrder = 11;
    mesh.add(bar);

    const d = { mesh, bar, barBg, hp: DUMMY_HP, hurtTimer: 0, respawnTimer: 0, dead: false, homeX: x, homeZ: z };
    // Generous hitbox for easy target practice
    const hb = makeHitbox(1.6, 2.4, 1.6, null);
    hb.userData.isHitbox = false;
    hb.userData.isDummy = true;
    hb.userData.dummy = d;
    hb.position.set(0, 0.3, 0);
    mesh.add(hb);
    d.hitbox = hb;
    // HP number above the bar
    const hpt = makeHpTextSprite(false);
    hpt.sprite.position.set(0, 1.6, 0);
    mesh.add(hpt.sprite);
    d.hpTextData = hpt;
    updateHpText(hpt, DUMMY_HP, DUMMY_HP, false);
    game.scene.add(mesh);
    game.dummies.push(d);
    return d;
}

function damageDummy(d, dmg) {
    if (d.dead) return;
    d.hp -= dmg;
    d.hurtTimer = 0.1;
    if (d.hpTextData) updateHpText(d.hpTextData, d.hp, DUMMY_HP, false);
    if (d.hp <= 0) {
        d.dead = true;
        d.mesh.visible = false;
        d.respawnTimer = DUMMY_RESPAWN;
    }
}

function updateDummies(dt) {
    for (const d of game.dummies) {
        if (d.dead) {
            d.respawnTimer -= dt;
            if (d.respawnTimer <= 0) {
                d.hp = DUMMY_HP;
                d.dead = false;
                d.mesh.visible = true;
                d.bar.scale.x = 1;
                d.bar.position.x = 0;
                if (d.hpTextData) updateHpText(d.hpTextData, d.hp, DUMMY_HP, false);
            }
            continue;
        }
        if (d.hurtTimer > 0) {
            d.hurtTimer -= dt;
            d.mesh.material = DUMMY_HURT;
            if (d.hurtTimer <= 0) d.mesh.material = DUMMY_MAT;
        }
        d.bar.lookAt(game.camera.position);
        d.barBg.lookAt(game.camera.position);
        const pct = Math.max(0, d.hp / DUMMY_HP);
        d.bar.scale.x = pct;
        d.bar.position.x = -(1 - pct) * 0.48;
    }
}

function createStartPad() {
    // Glowing green pad with a ring
    const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(START_PAD_RADIUS, START_PAD_RADIUS, 0.1, 32),
        new THREE.MeshStandardMaterial({
            color: 0x00ff55, emissive: 0x00aa33, emissiveIntensity: 0.8,
        })
    );
    pad.position.copy(START_PAD_POS);
    pad.receiveShadow = true;
    game.scene.add(pad);
    // Animated outer ring
    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(START_PAD_RADIUS + 0.2, 0.15, 8, 32),
        new THREE.MeshStandardMaterial({ color: 0xaaff88, emissive: 0x55ff33, emissiveIntensity: 1 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(START_PAD_POS).setY(0.3);
    game.scene.add(ring);
    // Beacon of light
    const beacon = new THREE.PointLight(0x88ff44, 1.5, 20);
    beacon.position.copy(START_PAD_POS).setY(2);
    game.scene.add(beacon);
    game.startPad = { pad, ring, beacon };
}

function buildLobby() {
    createStartPad();
    for (const p of DUMMY_POSITIONS) spawnDummy(p.x, p.z);
}

function clearLobby() {
    for (const d of game.dummies) game.scene.remove(d.mesh);
    game.dummies = [];
    if (game.startPad) {
        game.scene.remove(game.startPad.pad);
        game.scene.remove(game.startPad.ring);
        game.scene.remove(game.startPad.beacon);
        game.startPad = null;
    }
}

function updateLobby(dt) {
    // Animate ring
    if (game.startPad) {
        game.startPad.ring.rotation.z += dt * 1.5;
        game.startPad.ring.position.y = 0.3 + Math.sin(performance.now() * 0.004) * 0.15;
    }
    updateDummies(dt);
    // Check if player stepped onto the pad
    const dx = game.player.pos.x - START_PAD_POS.x;
    const dz = game.player.pos.z - START_PAD_POS.z;
    if (dx * dx + dz * dz < START_PAD_RADIUS * START_PAD_RADIUS) {
        enterPlayingState();
    }
}

function enterPlayingState() {
    if (game.state !== 'lobby') return;
    game.state = 'playing';
    clearLobby();
    const hint = document.getElementById('lobby-hint');
    if (hint) hint.classList.add('hidden');
    startWaves();
    showMessage('VIEL GLÜCK!', 1500);
}

function showLobbyHint() {
    const hint = document.getElementById('lobby-hint');
    if (hint) hint.classList.remove('hidden');
}
function updateDamageFlash(dt) {
    if (game.player.damageFlashTimer > 0) {
        game.player.damageFlashTimer -= dt;
        if (game.player.damageFlashTimer <= 0) document.body.classList.remove('damage');
    }
}
function handleClick() {
    if (game.mode === 'build') {
        if (game.buildCooldown <= 0) {
            if (placeBuild()) game.buildCooldown = 0.12;
            else game.buildCooldown = 0.08;
        }
        return;
    }
    if (game.mode === 'edit') { editClick(); return; }
    if (game.mode === 'heal') { useMedkit(); return; }
    if (game.mode === 'combat') { shoot(); return; }
}

function showMessage(text, ms = 1500) {
    const el = document.getElementById('message');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(showMessage._t);
    showMessage._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function updateHudCounters() {
    const p = game.player;
    document.getElementById('wood-count').textContent = p.wood;
    document.getElementById('score').textContent = 'Kills: ' + p.kills;
    document.getElementById('wave').textContent = 'Welle: ' + p.wave;
    document.getElementById('enemies-left').textContent =
        'Gegner: ' + (game.enemies.length + game.spawnQueue + game.bossQueue);
    const hpPct = Math.max(0, p.hp) / MAX_HP * 100;
    const shPct = Math.max(0, p.shield) / MAX_SHIELD * 100;
    document.getElementById('health-bar').style.width = hpPct + '%';
    document.getElementById('shield-bar').style.width = shPct + '%';
    document.getElementById('health-text').textContent = Math.max(0, Math.round(p.hp));
    document.getElementById('shield-text').textContent = Math.max(0, Math.round(p.shield));
    const ammo = p.weaponAmmo[p.currentWeapon];
    if (ammo) {
        document.getElementById('ammo-text').textContent = ammo.clip + ' / ' + ammo.reserve;
    }
    const mk = document.getElementById('medkit-count');
    if (mk) mk.textContent = p.medkits;
}
// === 8. EDIT SYSTEM ==========================================
// Classic Fortnite-style: look at your own structure, press G → 3×3 overlay.
// Click cells to toggle them OFF, press G again to commit (cells toggled off
// become holes; wall with middle-bottom removed = door).

const EDIT_CELL_MAT_ON  = new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
const EDIT_CELL_MAT_OFF = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.35, side: THREE.DoubleSide });

function getLookedAtBuild() {
    const origin = game.player.pos.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(game.camera.quaternion);
    game.raycaster.set(origin, dir);
    game.raycaster.far = 6;
    const meshes = game.builds.map(b => b.mesh);
    const hits = game.raycaster.intersectObjects(meshes, true); // recurse into groups
    if (!hits.length) return null;
    // walk up to find the owning build
    return game.builds.find(b => {
        let o = hits[0].object;
        while (o) { if (o === b.mesh) return true; o = o.parent; }
        return false;
    }) || null;
}

function toggleEditMode() {
    if (game.mode === 'edit') {
        commitEdit();
        return;
    }
    const struct = getLookedAtBuild();
    if (!struct) { showMessage('Keine Struktur im Visier', 800); return; }
    if (struct.type === 'ramp' || struct.type === 'roof') {
        showMessage('Nur Wand & Boden editierbar', 1200);
        return;
    }
    startEdit(struct);
}

function startEdit(struct) {
    game.editing = struct;
    game.mode = 'edit';
    // restore from existing tiles or default 3x3 all ON
    game.editGrid = struct.tiles ? struct.tiles.map(row => row.slice()) : [
        [1,1,1],
        [1,1,1],
        [1,1,1],
    ];
    buildEditOverlay(struct);
    document.getElementById('edit-hint').classList.remove('hidden');
    updateModeHud();
}

function buildEditOverlay(struct) {
    clearEditOverlay();
    const size = GRID / 3;
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            const geo = new THREE.PlaneGeometry(size * 0.92, size * 0.92);
            const m = new THREE.Mesh(geo, game.editGrid[r][c] ? EDIT_CELL_MAT_ON : EDIT_CELL_MAT_OFF);
            // position cell relative to struct; local offsets, then transform by struct
            let lx = (c - 1) * size;
            let ly = (1 - r) * size; // row 0 on top
            let lz = 0;
            if (struct.type === 'floor') {
                // lay flat on top of floor; cells on XZ plane
                lx = (c - 1) * size;
                ly = 0.2; // slightly above floor
                lz = (r - 1) * size;
                m.rotation.x = -Math.PI / 2;
            } else {
                // wall: local XY plane, rotated by struct rotation around Y
                m.position.set(lx, ly, lz + 0.2);
                m.rotation.y = 0;
            }
            const world = new THREE.Vector3(lx, ly, lz);
            if (struct.type === 'wall') {
                // rotate XZ of offset by rotY
                const cos = Math.cos(struct.rotY), sin = Math.sin(struct.rotY);
                const wx = world.x * cos + world.z * sin;
                const wz = -world.x * sin + world.z * cos;
                world.x = wx; world.z = wz;
                // push slightly in front of wall
                world.x += Math.sin(struct.rotY) * 0.2;
                world.z += Math.cos(struct.rotY) * 0.2;
                m.rotation.y = struct.rotY;
            }
            m.position.set(
                struct.x + world.x,
                struct.y + world.y,
                struct.z + world.z
            );
            m.userData = { r, c, struct };
            game.scene.add(m);
            game.editMeshes.push(m);
        }
    }
}

function clearEditOverlay() {
    for (const m of game.editMeshes) game.scene.remove(m);
    game.editMeshes = [];
    document.getElementById('edit-hint').classList.add('hidden');
}

// Raycast against the 3x3 edit overlay and return the cell mesh under crosshair.
function pickEditCell() {
    const origin = game.player.pos.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(game.camera.quaternion);
    game.raycaster.set(origin, dir);
    game.raycaster.far = 8;
    const hits = game.raycaster.intersectObjects(game.editMeshes, false);
    return hits.length ? hits[0].object : null;
}

function setEditCell(cell, value) {
    const { r, c } = cell.userData;
    if (game.editGrid[r][c] === value) return;
    game.editGrid[r][c] = value;
    cell.material = value ? EDIT_CELL_MAT_ON : EDIT_CELL_MAT_OFF;
}

// Fortnite-style drag-paint: clicking a cell records whether we're painting
// "on" or "off", and while the mouse is held down every cell the crosshair
// touches gets set to the same value. Releases stop the paint.
function editClick() {
    const cell = pickEditCell();
    if (!cell) return;
    const { r, c } = cell.userData;
    const target = game.editGrid[r][c] ? 0 : 1;
    game.editDragValue = target;
    setEditCell(cell, target);
}

function updateEditDrag() {
    if (game.mode !== 'edit') return;
    if (!game.mouse.down) return;
    if (game.editDragValue === null || game.editDragValue === undefined) return;
    const cell = pickEditCell();
    if (!cell) return;
    setEditCell(cell, game.editDragValue);
}

function commitEdit() {
    const s = game.editing;
    if (!s) return;
    s.tiles = game.editGrid.map(row => row.slice());
    // Rebuild mesh: remove full box, re-add only enabled cells
    game.scene.remove(s.mesh);
    const group = new THREE.Group();
    const size = GRID / 3;
    const mat = s.type === 'wall' ? BUILD_MAT_WALL : BUILD_MAT_FLOOR;
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            if (!s.tiles[r][c]) continue;
            let cellMesh;
            if (s.type === 'wall') {
                cellMesh = new THREE.Mesh(new THREE.BoxGeometry(size * 0.98, size * 0.98, 0.25), mat);
                cellMesh.position.set((c - 1) * size, (1 - r) * size, 0);
            } else {
                cellMesh = new THREE.Mesh(new THREE.BoxGeometry(size * 0.98, 0.25, size * 0.98), mat);
                cellMesh.position.set((c - 1) * size, 0, (r - 1) * size);
            }
            cellMesh.castShadow = true;
            cellMesh.receiveShadow = true;
            group.add(cellMesh);
        }
    }
    group.position.set(s.x, s.y, s.z);
    group.rotation.y = s.rotY;
    game.scene.add(group);
    s.mesh = group;
    // Build per-tile collision boxes so the player can walk through removed cells (doors/windows)
    group.updateMatrixWorld(true);
    s.tileBoxes = [];
    group.traverse(obj => {
        if (obj.isMesh) {
            s.tileBoxes.push(new THREE.Box3().setFromObject(obj));
        }
    });
    s.box = structureBox(s.type, s.x, s.y, s.z, s.rotY); // outer bounding for quick reject
    clearEditOverlay();
    game.editing = null;
    game.editDragValue = null;
    game.mode = 'build';
    updateModeHud();
    updatePreview();
}

function cancelEdit() {
    clearEditOverlay();
    game.editing = null;
    game.editGrid = [];
    game.editDragValue = null;
}
function updateSlotHud() {
    document.querySelectorAll('.slot').forEach(s => {
        const idx = parseInt(s.dataset.slot);
        s.classList.toggle('active', idx === game.slot);
        // Sync locked state from unlock table
        if (idx >= 1 && idx <= 6) {
            const id = WEAPON_ORDER[idx - 1];
            const locked = !game.player.unlockedWeapons[id];
            s.classList.toggle('locked', locked);
            const lockEl = s.querySelector('.slot-lock');
            if (lockEl) lockEl.style.display = locked ? '' : 'none';
        }
    });
}

// Unlock the first locked weapon in WEAPON_ORDER. Returns the weapon id or null.
function unlockNextWeapon() {
    for (const id of WEAPON_ORDER) {
        if (!game.player.unlockedWeapons[id]) {
            game.player.unlockedWeapons[id] = true;
            // Give a full clip + reserve boost for the new weapon so the player
            // can immediately try it.
            const w = WEAPONS[id];
            const ammo = game.player.weaponAmmo[id];
            ammo.clip = w.clip;
            ammo.reserve = Math.min(w.max, ammo.reserve + w.start);
            updateSlotHud();
            return id;
        }
    }
    return null;
}

function showUnlockBanner(weaponId) {
    const w = WEAPONS[weaponId];
    const el = document.getElementById('unlock-banner');
    if (!el) return;
    el.innerHTML = '🏆 NEUE WAFFE: ' + w.name.toUpperCase() +
        '<span class="sub">Slot ' + weaponSlotOf(weaponId) + ' — Mausrad oder Nummerntaste</span>';
    el.classList.remove('hidden');
    // Restart the CSS animation by reflowing
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(showUnlockBanner._t);
    showUnlockBanner._t = setTimeout(() => el.classList.add('hidden'), 2800);
}

// Hit marker on the crosshair. Triggered from shoot() when we hit an enemy.
function flashHitMarker(isHeadshot) {
    const el = document.getElementById('hitmarker');
    if (!el) return;
    el.classList.toggle('headshot', !!isHeadshot);
    el.classList.add('hit');
    clearTimeout(flashHitMarker._t);
    flashHitMarker._t = setTimeout(() => el.classList.remove('hit'), 160);
}
function updateModeHud() {
    const el = document.getElementById('mode-indicator');
    el.className = '';
    if (game.mode === 'combat') {
        const w = WEAPONS[game.player.currentWeapon];
        el.textContent = w ? w.name.toUpperCase() : 'KAMPF';
        el.classList.add('combat');
    }
    else if (game.mode === 'heal')  { el.textContent = 'HEILEN';    el.classList.add('heal'); }
    else if (game.mode === 'build') { el.textContent = 'BAU-MODUS'; el.classList.add('build'); }
    else if (game.mode === 'edit')  { el.textContent = 'EDIT-MODUS'; el.classList.add('edit'); }
}

// === 11. GAME OVER / RESTART =================================
function gameOver() {
    game.running = false;
    game.paused = true;
    document.exitPointerLock();
    document.getElementById('final-score').textContent =
        'Kills: ' + game.player.kills + ' | Welle: ' + game.player.wave;
    document.getElementById('game-over').classList.remove('hidden');
}

function restart() {
    // Clear builds
    for (const b of game.builds) game.scene.remove(b.mesh);
    game.builds = [];
    // Clear enemies
    for (const e of game.enemies) game.scene.remove(e.mesh);
    game.enemies = [];
    // Clear boss projectiles
    for (const pr of game.bossProjectiles) game.scene.remove(pr.mesh);
    game.bossProjectiles = [];
    // Clear any in-flight rockets
    for (const r of game.rockets) game.scene.remove(r.mesh);
    game.rockets = [];
    // Clear particles/bullets
    for (const b of game.bullets) game.scene.remove(b);
    game.bullets = [];
    for (const p of game.particles) game.scene.remove(p.obj);
    game.particles = [];
    // Clear floating damage numbers
    for (const dn of game.damageNumbers) {
        game.scene.remove(dn.sprite);
        if (dn.tex) dn.tex.dispose();
        if (dn.sprite.material) dn.sprite.material.dispose();
    }
    game.damageNumbers = [];
    // Reset player
    game.player.pos.set(0, PLAYER_HEIGHT, 0);
    game.player.vel.set(0, 0, 0);
    game.player.hp = MAX_HP;
    game.player.shield = MAX_SHIELD;
    game.player.wood = 500;
    game.player.kills = 0;
    game.player.wave = 1;
    game.player.medkits = START_MEDKITS;
    game.player.currentWeapon = 'pistol';
    game.player.weaponAmmo = makeInitialWeaponAmmo();
    game.player.unlockedWeapons = makeInitialUnlocks();
    game.player.reloading = false;
    game.player.reloadTimer = 0;
    game.player.shootCooldown = 0;
    game.player.healCd = 0;
    game.player.lastDamageTime = 0;
    game.slot = 1;
    game.mode = 'combat';
    game.bossQueue = 0;
    game.spawnQueue = 0;
    game.mouse.down = false;
    game.mouse.rightDown = false;
    if (game.editing) cancelEdit();
    // Tear down any remaining lobby props and jump straight into action.
    clearLobby();
    const hint = document.getElementById('lobby-hint');
    if (hint) hint.classList.add('hidden');
    game.state = 'playing';
    updateSlotHud();
    updateModeHud();
    updateViewmodel();
    updateHudCounters();
    document.getElementById('game-over').classList.add('hidden');
    document.body.classList.remove('damage');
    game.running = true;
    // If pointer is still locked (mid-game restart via N key) continue playing immediately.
    // Otherwise (restart from game-over / pause screen) wait for user to click the blocker.
    game.paused = !game.locked;
    startWaves();
}

// === INIT ====================================================
function init() {
    setupScene();
    setupInput();
    game.clock = new THREE.Clock();
    game.running = true;
    game.state = 'lobby';
    buildLobby();
    showLobbyHint();
    updateSlotHud();
    updateModeHud();
    updateViewmodel();
    updateHudCounters();

    document.getElementById('restart-btn').addEventListener('click', restart);
    const blockerRestart = document.getElementById('blocker-restart-btn');
    blockerRestart.addEventListener('click', (ev) => {
        // Prevent the blocker's "click to lock pointer" handler from firing.
        ev.stopPropagation();
        restart();
    });

    if (!('requestPointerLock' in document.body)) {
        showMessage('Browser unterstützt Pointer Lock nicht', 4000);
    }

    loop();
}

init();
