/* =========================
   ZType-style game with:
   - FIFO targeting
   - Staggered spawn
   - Abilities LIFO (stack limit 10)
   - ENTER to start/pause/resume
   - Panel warning + minimal red flash on blocked pickup
   ========================= */

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('scoreVal');
const healthEl = document.getElementById('healthVal');
const startLabel = document.getElementById('start');
const stackList = document.getElementById('stackList');
const abilityFullWarning = document.getElementById('abilityFullWarning');
const minimalFlash = document.getElementById('minimalFlash');
const mobileInput = document.getElementById('mobileInput');

const DPR = Math.max(1, window.devicePixelRatio || 1);
const wrap = document.getElementById('left');

function resizeCanvas(){
  const Wpx = wrap.clientWidth, Hpx = wrap.clientHeight;
  canvas.style.width = Wpx + 'px';
  canvas.style.height = Hpx + 'px';
  canvas.width = Math.floor(Wpx * DPR);
  canvas.height = Math.floor(Hpx * DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const WIDTH = ()=> wrap.clientWidth;
const HEIGHT = ()=> wrap.clientHeight;
const now = ()=> performance.now();
const rand = (a,b)=> Math.random()*(b-a)+a;

function isMobileDevice(){
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// wordlist
const WORDS = [
  "trip","lack","watch","drive","pick","side","apple","ghost","robot","spark",
  "prime","orbit","laser","blade","storm","nova","vortex","plasma","alien","core",
  "shield","freeze","blaster","turbo","vector","chrono","ion","rocket","asteroid","comet",
  "beam","cog","net","hub","disk","chip","pad","key","pin","bot","flux","ray","arc",
  "sun","moon","star","sky","cloud","rain","wind","fire","ice","sea","sand","rock","tree",
  "leaf","fish","frog","bird","ant","bee","cat","dog","bat","owl","owl","rat","mud","gum",
  "matrix","fusion","gravity","photon","circuit","reactor","module","turret","drone",
  "asterism","blackhole","catalyst","dynamo","electron","fractal","galaxy","horizon",
  "nebula","parallax","quantum","radiate","singularity","tachyon","variable","yield",
  "orbitals","magnetism","radiation","spectrum","velocity","trajectory","momentum","pulsar",
  "satellite","antenna","sensor","engine","compressor","resistor","capacitor","generator",
  "transistor","conductor","refraction","diffuser","oscillator","amplifier",
  "ultraviolet","diffraction","entropy","hypernova","manifold","oscillation","quintessence",
  "spectroscopy","thermodynamics","interstellar","luminescence","photosynthesis","electromagnetism",
  "microprocessor","neutrino","gravitational","supernova","astrophysics","cosmology"
];

let SPAWN_MS = 500;
const MIN_X_SPACING = 120;
const MAX_ONSCREEN = 6;
let ENEMY_SPEED = 1;
let BULLET_SPEED = 10000;
const DIFF_PERIOD = 16000;
const VERTICAL_SPAWN_GAP = 10;
const DROP_CHANCE = 0.28;
const ABILITY_POOL = ['shield','timeSlow','chainLightning','homing','explosion','freeze','scoreBomb','rapidFire','piercing'];

const ENEMY_CIRCLE_RADIUS = 9;
const CIRCLE_HIT_RADIUS = ENEMY_CIRCLE_RADIUS + 8;

// MAX stack
const MAX_ABILITY_STACK = 10;

let running=false, lastTime=0, spawnTimer=0, spawnInterval=SPAWN_MS, difficultyTimer=0;
let enemies=[], bullets=[], particles=[];
let score=0, abilityStack=[], health=5;

// pause flag
let paused = false;

// small timeout handles
let _flashTimeout = null;

const active = {
  timeSlowUntil: 0,
  homingUntil: 0,
  rapidFireUntil: 0,
  chainCharges: 0,
  explosionNext: false,
  shieldCount: 0,
  freezeUntil: 0,
  piercingNext: false
};

// ---------------- UI stack functions ----------------
function renderStack(){
  stackList.innerHTML = '';
  for(let i = abilityStack.length-1; i >= 0; i--){
    const it = abilityStack[i];
    const div = document.createElement('div');
    div.className = 'abilityItem' + (i === abilityStack.length-1 ? ' top' : '');
    div.dataset.id = it.id;
    const name = document.createElement('div'); name.className='abilityName'; name.textContent = it.name;
    const small = document.createElement('div'); small.className='abilitySmall'; small.textContent = new Date(it.createdAt).toLocaleTimeString();
    div.appendChild(name); div.appendChild(small);
    if(i === abilityStack.length-1){
      div.style.cursor = 'pointer';
      div.addEventListener('click', ()=> { useTopAbility(); });
    } else { div.style.opacity = 0.75; }
    stackList.appendChild(div);
  }
  if(abilityStack.length === 0) stackList.innerHTML = '<div class="abilitySmall">(empty)</div>';
  updateAbilityFullWarning();
}

// push with limit check
function pushAbility(name){
  if(abilityStack.length >= MAX_ABILITY_STACK){
    // blocked pickup
    triggerFullStackBlocked();
    return;
  }
  abilityStack.push({name, id: Math.random().toString(36).slice(2,9), createdAt: now()});
  renderStack();
}

// pop
function popAbility(){ const it = abilityStack.pop(); renderStack(); return it; }

// ---------------- Warning + minimal flash ----------------

function triggerMinimalRedFlash(){
  // very subtle ambient red flash for 180ms
  if(_flashTimeout) clearTimeout(_flashTimeout);
  minimalFlash.style.opacity = '0.98';
  // set to a low visible level then quickly fade out to 0
  requestAnimationFrame(()=> {
    minimalFlash.style.opacity = '0.12'; // subtle
  });
  _flashTimeout = setTimeout(()=> {
    minimalFlash.style.opacity = '0';
    _flashTimeout = null;
  }, 180);
}

function triggerFullStackBlocked(){
  // Called when player attempts to pick up ability but stack is full
  // 1) ensure the panel warning is pulsing (will remain while stack==10)
  updateAbilityFullWarning(); // makes sure animation running
  // 2) trigger minimal red flash once
  triggerMinimalRedFlash();
}

// update the ability-full panel warning depending on stack size
function updateAbilityFullWarning(){
  if(abilityStack.length >= MAX_ABILITY_STACK){
    // start pulsing (if not already)
    abilityFullWarning.style.opacity = '1';
    abilityFullWarning.style.animation = 'abilityPulse 1.2s infinite';
  } else {
    // stop pulsing and hide
    abilityFullWarning.style.animation = 'none';
    abilityFullWarning.style.opacity = '0';
  }
}

// ---------------- ship / enemies / bullets / particles ----------------

const ship = { x:null, y:null };

class Enemy {
  constructor(word, x){
    this.word = word;
    this.x = x;
    this.y = -rand(20,80);
    this.speed = ENEMY_SPEED;
    this.dead = false;
    this.id = now() + Math.random();
    this.dropped = false;
  }
  update(dt){
    let sp = this.speed;
    if(now() < active.timeSlowUntil) sp *= 0.6;
    if(now() < active.freezeUntil) sp *= 0.08;
    this.y += sp * (dt/16.67);
    if(this.y > HEIGHT() - 40 && !this.dead){
      this.dead = true;
      if(active.shieldCount > 0){
        active.shieldCount = Math.max(0, active.shieldCount - 1);
      } else {
        health = Math.max(0, health - 1);
        healthEl.textContent = health;
        if(health <= 0) endGame();
      }
      spawnDeathParticles(this.x, this.y);
    }
  }
  removeFirstChar(){ if(this.word.length > 0) this.word = this.word.slice(1); }
  draw(){
    ctx.save();
    ctx.font = '18px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#eafaf7';
    ctx.fillText(this.word, this.x, this.y - 36);
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,160,100,0.95)';
    ctx.lineWidth = 1.6;
    ctx.arc(this.x, this.y - 12, ENEMY_CIRCLE_RADIUS, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }
}

class Bullet {
  constructor(char, targetEnemy){
    this.char = char;
    this.x = ship.x; this.y = ship.y - 20;
    this.prevX = this.x; this.prevY = this.y;
    this.targetEnemy = targetEnemy || null;
    if(this.targetEnemy){ this.tx = this.targetEnemy.x; this.ty = this.targetEnemy.y - 12; } else { this.tx = this.x; this.ty = this.y - 200; }
    let speed = BULLET_SPEED;
    if(now() < active.rapidFireUntil) speed *= 1.6;
    const dx = this.tx - this.x, dy = this.ty - this.y;
    const d = Math.hypot(dx, dy) || 1;
    this.vx = (dx/d) * speed; this.vy = (dy/d) * speed;
    this.alive = true;
    this.len = 60 + Math.random()*30;
    this.explosive = false;
    this.piercing = active.piercingNext === true;
    if(active.explosionNext){ this.explosive = true; active.explosionNext = false; }
    if(active.piercingNext){ active.piercingNext = false; }
  }
  update(dt){
    this.prevX = this.x; this.prevY = this.y;
    this.x += this.vx * (dt/1000);
    this.y += this.vy * (dt/1000);

    if(!this.targetEnemy || this.targetEnemy.dead){
      if(now() < active.homingUntil){
        const nearest = enemies.reduce((best,e) => {
          if(e.dead) return best;
          const d = Math.hypot(e.x - this.x, (e.y - 12) - this.y);
          if(!best || d < best.d) return { e, d };
          return best;
        }, null);
        if(nearest){ this.targetEnemy = nearest.e; this.tx = this.targetEnemy.x; this.ty = this.targetEnemy.y-12; }
        else if(!this.piercing) { this.alive = false; return; }
      } else if(!this.piercing){
        this.alive = false;
        return;
      }
    }

    if(this.piercing){
      for(const enemy of enemies){
        if(enemy.dead) continue;
        const cx = enemy.x, cy = enemy.y - 12, r = CIRCLE_HIT_RADIUS;
        if(lineSegmentCircleIntersect(this.prevX, this.prevY, this.x, this.y, cx, cy, r)){
          handleBulletHit(this, enemy);
        }
      }
    } else {
      const enemy = this.targetEnemy;
      if(enemy && !enemy.dead){
        const cx = enemy.x, cy = enemy.y - 12, r = CIRCLE_HIT_RADIUS;
        if(lineSegmentCircleIntersect(this.prevX, this.prevY, this.x, this.y, cx, cy, r)){
          handleBulletHit(this, enemy);
          this.alive = false;
          return;
        }
      }
    }

    if(this.x < -200 || this.x > WIDTH()+200 || this.y < -200 || this.y > HEIGHT()+200){
      this.alive = false;
    }
  }
  draw(){
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const ang = Math.atan2(this.vy, this.vx);
    ctx.translate(this.x, this.y);
    ctx.rotate(ang);
    const L = this.len;
    const g = ctx.createLinearGradient(-L, 0, 0, 0);
    g.addColorStop(0, 'rgba(220,240,255,0.02)');
    g.addColorStop(0.6, 'rgba(220,240,255,0.28)');
    g.addColorStop(1, 'rgba(220,240,255,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(-L, -6, L, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(-L*0.9, -2.5, L*0.9, 5);
    ctx.beginPath();
    ctx.arc(0,0,5.2,0,Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.98)';
    ctx.fill();
    ctx.restore();
  }
}

// line-segment circle collision helper
function lineSegmentCircleIntersect(x1,y1,x2,y2, cx,cy, r){
  const dx = x2 - x1, dy = y2 - y1;
  const fx = x1 - cx, fy = y1 - cy;
  const a = dx*dx + dy*dy;
  const b = 2*(fx*dx + fy*dy);
  const c = fx*fx + fy*fy - r*r;
  if(a === 0) return (fx*fx + fy*fy) <= r*r;
  let disc = b*b - 4*a*c;
  if(disc < 0) return false;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2*a);
  const t2 = (-b + disc) / (2*a);
  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
}

// handle bullet hit
function handleBulletHit(bullet, enemy){
  if(active.chainCharges > 0){
    const second = enemies.find(e => !e.dead && e.id !== enemy.id && Math.abs(e.y - enemy.y) < 120 && Math.abs(e.x - enemy.x) < 150);
    if(second) bullets.push(new Bullet(second.word[0], second));
    active.chainCharges = Math.max(0, active.chainCharges - 1);
  }

  if(bullet.explosive){
    for(const e of enemies){
      if(e.dead) continue;
      if(Math.hypot(e.x - enemy.x, e.y - enemy.y) < 48){
        e.removeFirstChar();
        spawnHitParticle(e.x, e.y-12);
        if(e.word.length === 0){ e.dead = true; spawnDeathParticles(e.x, e.y); score += 60; handleDrop(e); }
        else score += 8;
      }
    }
  }

  enemy.removeFirstChar();
  spawnHitParticle(enemy.x, enemy.y-12);
  if(enemy.word.length === 0){
    enemy.dead = true;
    spawnDeathParticles(enemy.x, enemy.y);
    score += 60;
    handleDrop(enemy);
  } else {
    score += 8;
  }
  scoreEl.textContent = score;
}

// drops
function handleDrop(enemy){
  if(enemy.dropped) return;
  enemy.dropped = true;
  if(Math.random() < DROP_CHANCE){
    const pick = ABILITY_POOL[Math.floor(Math.random()*ABILITY_POOL.length)];
    pushAbility(pick); // pushAbility handles full stack blocking
    spawnHitParticle(enemy.x, enemy.y - 12);
  }
}

// particles
function spawnHitParticle(x,y){ particles.push({ x,y,vx:(Math.random()-0.5)*2,vy:(Math.random()-1)*2,born:now(),life:380,size:1+Math.random()*3,color:'#aef2ff' }); }
function spawnDeathParticles(x,y){ for(let i=0;i<18;i++){ particles.push({ x,y,vx:(Math.random()-0.5)*6,vy:(Math.random()-1.5)*6,born:now(),life:700+Math.random()*300,size:1+Math.random()*4,color:['#aef2ff','#ffd4a6','#fff'][Math.floor(Math.random()*3)] }); } }
function updateParticles(dt){ const t = now(); particles = particles.filter(p => (t - p.born) < p.life); for(const p of particles){ p.x += p.vx*(dt/16.67); p.y += p.vy*(dt/16.67); p.vy += 0.06*(dt/16.67); } }
function drawParticles(){ ctx.save(); ctx.globalCompositeOperation = 'lighter'; for(const p of particles){ const life = (now()-p.born)/p.life; const a = Math.max(0,1-life); ctx.globalAlpha = a; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2); ctx.fill(); } ctx.restore(); }

// grid & ship draw
function drawGrid(offset){
  const s = 48;
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = '#06313a';
  ctx.lineWidth = 1;
  for(let x = -s + (offset % s); x < WIDTH() + s; x += s){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,HEIGHT()); ctx.stroke(); }
  for(let y = -s + (offset % s); y < HEIGHT() + s; y += s){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(WIDTH(),y); ctx.stroke(); }
  ctx.restore();
}
function drawShip(){
  if(!ship.x){ ship.x = WIDTH()/2; ship.y = HEIGHT()-64; }
  const sx = ship.x, sy = ship.y;
  ctx.save();
  ctx.beginPath(); ctx.arc(sx, sy+8, 28, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(45,212,191,0.06)'; ctx.fill();
  ctx.fillStyle = '#2dd4bf';
  ctx.beginPath(); ctx.moveTo(sx, sy-16); ctx.lineTo(sx+14, sy+12); ctx.lineTo(sx-14, sy+12); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// spawn utils
function chooseSpawnX(){
  const margin = 70;
  for(let attempt=0; attempt<100; attempt++){
    const x = rand(margin, WIDTH()-margin);
    let ok = true;
    for(const e of enemies) if(Math.abs(e.x - x) < MIN_X_SPACING){ ok = false; break; }
    if(ok) return x;
  }
  return rand(120, WIDTH()-120);
}
function spawnEnemyImmediate(){
  if(enemies.filter(e=>!e.dead).length >= MAX_ONSCREEN) return;
  const w = WORDS[Math.floor(Math.random()*WORDS.length)];
  const x = chooseSpawnX();
  const e = new Enemy(w, x);
  e.speed = ENEMY_SPEED;
  enemies.push(e);
}

// Main game loop: handles updates, rendering, and game state
function gameTick(ts){
  const t = now();
  const dt = Math.min(48, t - lastTime);
  lastTime = t;

  ctx.clearRect(0,0, WIDTH(), HEIGHT());
  drawGrid(t*0.02);

  if(!running){
    for(const e of enemies) e.draw();
    drawParticles();
    drawShip();
    return requestAnimationFrame(gameTick);
  }

  // If paused: draw scene but don't update simulation
  if(paused){
    for(const e of enemies) e.draw();
    for(const b of bullets) b.draw();
    drawParticles();
    drawShip();
    startLabel.textContent = 'PAUSED — PRESS ENTER TO RESUME';
    startLabel.style.display = 'block';
    return requestAnimationFrame(gameTick);
  } else {
    startLabel.style.display = 'none';
  }

  // difficulty progression
  difficultyTimer += dt;
  if(difficultyTimer >= DIFF_PERIOD){
    difficultyTimer = 0;
    ENEMY_SPEED += 0.02;
    for(const e of enemies) e.speed = ENEMY_SPEED;
    spawnInterval = Math.max(160, spawnInterval - 20);
  }

  // spawn logic
  spawnTimer += dt;
  if(spawnTimer >= spawnInterval){
    spawnTimer -= spawnInterval;
    const alive = enemies.filter(e=>!e.dead);
    const canSpawnNow = alive.length < MAX_ONSCREEN && (
      alive.length === 0 ||
      (alive[alive.length - 1].y > VERTICAL_SPAWN_GAP)
    );
    if(canSpawnNow) spawnEnemyImmediate();
  }

  // updates
  for(const e of enemies) if(!e.dead) e.update(dt);
  for(const b of bullets) b.update(dt);

  bullets = bullets.filter(b=>b.alive);
  enemies = enemies.filter(e=>!e.dead && e.y < HEIGHT() + 80);
  updateParticles(dt);

  // draws
  for(const e of enemies) e.draw();
  for(const b of bullets) b.draw();
  drawParticles();
  drawShip();

  requestAnimationFrame(gameTick);
}

// abilities usage
function useTopAbility(){
  if(abilityStack.length === 0) return;
  const top = popAbility();
  const t = now();
  switch(top.name){
    case 'shield':
      active.shieldCount = (active.shieldCount || 0) + 1;
      break;
    case 'timeSlow':
      active.timeSlowUntil = t + 6000;
      break;
    case 'chainLightning':
      active.chainCharges = 3;
      break;
    case 'homing':
      active.homingUntil = t + 5000;
      break;
    case 'explosion':
      active.explosionNext = true;
      break;
    case 'freeze':
      active.freezeUntil = t + 3000;
      break;
    case 'scoreBomb':
      for(const e of enemies){
        if(!e.dead){ score += 10; spawnHitParticle(e.x, e.y - 12); }
      }
      scoreEl.textContent = score;
      break;
    case 'rapidFire':
      active.rapidFireUntil = t + 4500;
      break;
    case 'piercing':
      active.piercingNext = true;
      break;
    default:
      break;
  }
}

// Keyboard input handler (shooting, abilities, pause/start)
document.addEventListener('keydown', (ev) => {
  // ENTER: start / pause / resume
  if(ev.key === 'Enter'){
    if(!running){ startGame(); return; }
    // toggle pause/resume
    paused = !paused;
    if(paused){
      startLabel.textContent = 'PAUSED — PRESS ENTER TO RESUME';
      startLabel.style.display = 'block';
    } else {
      startLabel.style.display = 'none';
    }
    return;
  }

  // use ability with Space
  if(ev.code === 'Space' || ev.key === ' '){
    ev.preventDefault();
    if(paused) return;
    useTopAbility();
    return;
  }

  // only letters for shooting
  if(!/^[a-zA-Z]$/.test(ev.key)) return;
  if(!running) return;
  if(paused) return;

  const ch = ev.key.toLowerCase();
  const front = enemies.find(e => !e.dead && e.word.length > 0);
  if(!front) return;
  if(front.word[0].toLowerCase() === ch){
    bullets.push(new Bullet(ch, front));
  }
});

// MOBILE INPUT: handle on-screen keyboard typing
mobileInput.addEventListener('input', () => {
  if(!running || paused){
    mobileInput.value = '';
    return;
  }

  const text = mobileInput.value.toLowerCase();
  mobileInput.value = '';

  for(const ch of text){
    if(!/^[a-z]$/.test(ch)) continue;

    const front = enemies.find(e => !e.dead && e.word.length > 0);
    if(!front) return;

    if(front.word[0].toLowerCase() === ch){
      bullets.push(new Bullet(ch, front));
    }
  }
});


// start game
function startGame(){
  running = true;
  paused = false;
  lastTime = now();
  spawnTimer = 0;
  spawnInterval = SPAWN_MS;
  difficultyTimer = 0;
  enemies = [];
  bullets = [];
  particles = [];
  score = 0;
  abilityStack = [];
  health = 5;
  active.timeSlowUntil = 0;
  active.homingUntil = 0;
  active.rapidFireUntil = 0;
  active.chainCharges = 0;
  active.explosionNext = false;
  active.shieldCount = 0;
  active.freezeUntil = 0;
  active.piercingNext = false;

  scoreEl.textContent = score;
  healthEl.textContent = health;
  renderStack();
  startLabel.style.display = 'none';

  spawnEnemyImmediate();
  requestAnimationFrame(gameTick);

  // OPEN MOBILE KEYBOARD
  if(isMobileDevice()){
    try {
      mobileInput.value = '';
      mobileInput.focus({ preventScroll: true });
      setTimeout(resizeCanvas, 250);
    } catch(e){
      mobileInput.focus();
    }
  }
}

// end game
function endGame(){
  running = false;
  paused = false;
  startLabel.textContent = 'GAME OVER — PRESS ENTER TO RESTART';
  startLabel.style.display = 'block';
  try { mobileInput.blur(); } catch(e){}
}

// optional: click start label to start
startLabel.addEventListener('click', ()=> { if(!running) startGame(); });

// REFRESH MOBILE KEYBOARD ON TAP
document.getElementById('left').addEventListener('touchstart', () => {
  if(isMobileDevice()){
    try {
      mobileInput.focus({ preventScroll: true });
    } catch(e){
      mobileInput.focus();
    }
  }
});


// initial UI
renderStack();
scoreEl.textContent = score;
healthEl.textContent = health;

// begin animation loop (idle)
lastTime = now();
requestAnimationFrame(gameTick);
