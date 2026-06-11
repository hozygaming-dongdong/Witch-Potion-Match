const TYPES = ["red", "yellow", "blue", "green", "purple"];
const TYPE_LABEL = { red: "紅", yellow: "黃", blue: "藍", green: "綠", purple: "紫" };
const SIZE = 6;
const START_COINS = 1000;
const MAX_SMALL_WIN = 8;
const POTION_NEED = 10;
const MAX_CASCADES_PER_MOVE = 10;

const state = {
  board: [],
  coins: START_COINS,
  bet: 10,
  selected: null,
  busy: false,
  order: null,
  orderPotions: Object.fromEntries(TYPES.map(t => [t, 0])),
  moveStats: null
};

let toastTimer = null;
let cauldronGlowTimer = null;

const els = {
  shell: document.querySelector(".phone-shell"),
  board: document.querySelector("#board"),
  coins: document.querySelector("#coins"),
  bet: document.querySelector("#betSelect"),
  soundToggle: document.querySelector("#soundToggle"),
  newGame: document.querySelector("#newGame"),
  cauldron: document.querySelector("#cauldron"),
  cauldronText: document.querySelector("#cauldronText"),
  coinBurst: document.querySelector("#coinBurst"),
  bigWin: document.querySelector("#bigWin"),
  bigWinAmount: document.querySelector("#bigWinAmount"),
  toast: document.querySelector("#toast"),
  orderText: document.querySelector("#orderText"),
  orderMeta: document.querySelector("#orderMeta"),
  turnsLeft: document.querySelector("#turnsLeft"),
  clearedCount: document.querySelector("#clearedCount"),
  cascadeCount: document.querySelector("#cascadeCount"),
  smallWin: document.querySelector("#smallWin"),
  orderWin: document.querySelector("#orderWin")
};

const sound = {
  ctx: null,
  enabled: true,
  started: false
};

function ensureAudio() {
  if (!sound.enabled) return;
  if (!sound.ctx) sound.ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (sound.ctx.state === "suspended") sound.ctx.resume();
  sound.started = true;
}

function tone(freq, duration = 0.08, type = "square", gain = 0.045, when = 0) {
  if (!sound.enabled || !sound.ctx) return;
  const t = sound.ctx.currentTime + when;
  const osc = sound.ctx.createOscillator();
  const vol = sound.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  vol.gain.setValueAtTime(0.0001, t);
  vol.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  vol.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(vol).connect(sound.ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function sfx(name) {
  if (!sound.enabled) return;
  ensureAudio();
  const map = {
    tap: () => tone(360, 0.045, "square", 0.025),
    swap: () => { tone(430, 0.055, "triangle", 0.035); tone(610, 0.055, "triangle", 0.03, 0.045); },
    invalid: () => { tone(170, 0.09, "sawtooth", 0.035); tone(120, 0.1, "sawtooth", 0.03, 0.08); },
    clear: () => { tone(620, 0.08, "square", 0.04); tone(820, 0.08, "square", 0.03, 0.055); },
    drop: () => tone(260, 0.06, "triangle", 0.025),
    special: () => { tone(520, 0.08, "square", 0.04); tone(900, 0.12, "triangle", 0.04, 0.08); },
    coin: () => { tone(760, 0.07, "triangle", 0.035); tone(1040, 0.09, "triangle", 0.03, 0.07); },
    jackpot: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, "square", 0.04, i * 0.075)); }
  };
  map[name]?.();
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomType() {
  return TYPES[Math.floor(Math.random() * TYPES.length)];
}

function makeTile(type = randomType(), special = null) {
  return { id: uid(), type, special };
}

function biasedRefillType(r, c) {
  const winningTypes = TYPES.filter(type => wouldMatchIfPlaced(r, c, type));
  if (winningTypes.length && Math.random() < 0.22) {
    return winningTypes[randInt(0, winningTypes.length - 1)];
  }

  const weighted = [];
  TYPES.forEach(type => {
    let weight = 1;
    if (nearSameCount(r, c, type) >= 2) weight += 1;
    if (nearSameCount(r, c, type) === 1) weight += 1;
    if (wouldAlmostMatchIfPlaced(r, c, type)) weight += 1;
    for (let i = 0; i < weight; i++) weighted.push(type);
  });
  return weighted[randInt(0, weighted.length - 1)] || randomType();
}

function wouldMatchIfPlaced(r, c, type) {
  const prev = state.board[r][c];
  state.board[r][c] = { type };
  const horizontal = countDirection(r, c, 0, -1, type) + 1 + countDirection(r, c, 0, 1, type) >= 3;
  const vertical = countDirection(r, c, -1, 0, type) + 1 + countDirection(r, c, 1, 0, type) >= 3;
  state.board[r][c] = prev;
  return horizontal || vertical;
}

function wouldAlmostMatchIfPlaced(r, c, type) {
  return countDirection(r, c, 0, -1, type) + countDirection(r, c, 0, 1, type) >= 1 ||
    countDirection(r, c, -1, 0, type) + countDirection(r, c, 1, 0, type) >= 1;
}

function nearSameCount(r, c, type) {
  return [[-1, 0], [1, 0], [0, -1], [0, 1]].reduce((sum, [dr, dc]) => {
    const nr = r + dr;
    const nc = c + dc;
    return sum + (inside(nr, nc) && state.board[nr][nc]?.type === type ? 1 : 0);
  }, 0);
}

function countDirection(r, c, dr, dc, type) {
  let count = 0;
  let nr = r + dr;
  let nc = c + dc;
  while (inside(nr, nc) && state.board[nr][nc]?.type === type) {
    count += 1;
    nr += dr;
    nc += dc;
  }
  return count;
}

function init() {
  state.coins = START_COINS;
  state.bet = Number(els.bet.value);
  state.selected = null;
  state.busy = false;
  resetOrderPotions();
  createBoard();
  newOrder();
  resetMoveStats();
  renderAll();
  setToast("交換相鄰符石，只有有效消除才扣 BET。", 3600);
}

function createBoard() {
  state.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      let tile;
      do {
        tile = makeTile();
        state.board[r][c] = tile;
      } while (wouldStartMatch(r, c));
    }
  }
}

function wouldStartMatch(r, c) {
  const type = state.board[r][c].type;
  return (c >= 2 && state.board[r][c - 1]?.type === type && state.board[r][c - 2]?.type === type) ||
    (r >= 2 && state.board[r - 1][c]?.type === type && state.board[r - 2][c]?.type === type);
}

function renderAll() {
  els.coins.textContent = state.coins;
  renderBoard();
  renderOrder();
  renderPotions();
}

function renderBoard(dropInfo = new Map()) {
  els.board.innerHTML = "";
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const tile = state.board[r][c];
      const cell = document.createElement("button");
      cell.className = "tile";
      cell.type = "button";
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      if (tile) {
        cell.dataset.id = tile.id;
        if (tile.special) cell.dataset.special = tile.special;
        if (dropInfo.has(tile.id)) {
          const info = dropInfo.get(tile.id);
          cell.classList.add("drop");
          cell.style.setProperty("--drop-y", `${info.y}px`);
          cell.style.setProperty("--drop-delay", `${info.delay}ms`);
        }
        const gem = document.createElement("span");
        gem.className = `gem ${tile.type}`;
        cell.appendChild(gem);
      }
      if (state.selected?.r === r && state.selected?.c === c) cell.classList.add("selected");
      cell.addEventListener("pointerdown", () => onTilePress(r, c));
      els.board.appendChild(cell);
    }
  }
}

async function onTilePress(r, c) {
  ensureAudio();
  if (state.busy) return;
  if (state.coins < Number(els.bet.value)) {
    setToast("金幣不足，不能移動。");
    cauldronAct("湯鍋餓了，但錢包空了");
    return;
  }
  if (!state.selected) {
    sfx("tap");
    state.selected = { r, c };
    renderBoard();
    return;
  }
  const first = state.selected;
  state.selected = null;
  if (first.r === r && first.c === c) {
    renderBoard();
    return;
  }
  if (Math.abs(first.r - r) + Math.abs(first.c - c) !== 1) {
    state.selected = { r, c };
    renderBoard();
    return;
  }
  await trySwap(first, { r, c });
}

async function trySwap(a, b) {
  state.busy = true;
  state.bet = Number(els.bet.value);
  swap(a, b);
  sfx("swap");
  renderBoard();
  await wait(140);

  const specialResult = getSpecialSwapResult(a, b);
  const matches = findMatches();
  if (!specialResult && matches.groups.length === 0) {
    swap(a, b);
    sfx("invalid");
    renderBoard();
    setToast("無效交換，符石彈回，BET 不扣。");
    cauldronAct("沒有成方，湯鍋吐回去了");
    state.busy = false;
    return;
  }

  state.coins -= state.bet;
  resetMoveStats();
  cauldronAct(`投入 BET ${state.bet} 開始熬煮`);

  if (specialResult) {
    await resolveSpecialSwap(a, b, specialResult);
  } else {
    await resolveBoard(a);
  }
  finalizeMove();
  state.busy = false;
}

function swap(a, b) {
  const t = state.board[a.r][a.c];
  state.board[a.r][a.c] = state.board[b.r][b.c];
  state.board[b.r][b.c] = t;
}

function resetMoveStats() {
  state.moveStats = {
    cleared: 0,
    cascades: 0,
    potions: Object.fromEntries(TYPES.map(t => [t, 0])),
    createdSpecials: [],
    usedExplosion: false,
    smallWin: 0,
    orderWin: 0
  };
  updateResultPanel();
}

async function resolveBoard(origin) {
  let keepGoing = true;
  while (keepGoing) {
    const matches = findMatches();
    if (matches.groups.length === 0) break;
    if (state.moveStats.cascades >= MAX_CASCADES_PER_MOVE) break;
    state.moveStats.cascades += 1;
    const special = chooseSpecialToCreate(matches.groups, origin);
    const clearSet = new Set(matches.cells);
    if (special) clearSet.delete(key(special.r, special.c));
    await clearCells(clearSet, special);
    await collapseAndRefill();
    renderBoard();
    await wait(120);
    keepGoing = true;
  }
}

function findMatches() {
  const groups = [];
  const cellSet = new Set();

  for (let r = 0; r < SIZE; r++) {
    let c = 0;
    while (c < SIZE) {
      const start = c;
      const type = state.board[r][c]?.type;
      while (c < SIZE && state.board[r][c]?.type === type) c++;
      if (type && c - start >= 3) {
        const cells = [];
        for (let x = start; x < c; x++) cells.push({ r, c: x });
        groups.push({ dir: "h", type, cells });
        cells.forEach(pos => cellSet.add(key(pos.r, pos.c)));
      }
    }
  }

  for (let c = 0; c < SIZE; c++) {
    let r = 0;
    while (r < SIZE) {
      const start = r;
      const type = state.board[r][c]?.type;
      while (r < SIZE && state.board[r][c]?.type === type) r++;
      if (type && r - start >= 3) {
        const cells = [];
        for (let y = start; y < r; y++) cells.push({ r: y, c });
        groups.push({ dir: "v", type, cells });
        cells.forEach(pos => cellSet.add(key(pos.r, pos.c)));
      }
    }
  }

  return { groups, cells: [...cellSet] };
}

function chooseSpecialToCreate(groups, origin) {
  const byCell = new Map();
  groups.forEach(group => {
    group.cells.forEach(pos => {
      const k = key(pos.r, pos.c);
      if (!byCell.has(k)) byCell.set(k, []);
      byCell.get(k).push(group);
    });
  });

  const intersection = [...byCell.entries()].find(([, list]) => list.some(g => g.dir === "h") && list.some(g => g.dir === "v"));
  if (intersection) {
    const [k, list] = intersection;
    const [r, c] = k.split(",").map(Number);
    return { r, c, type: list[0].type, special: "bomb" };
  }

  const five = groups.find(g => g.cells.length >= 5);
  if (five) {
    const pos = preferredPos(five.cells, origin);
    return { ...pos, type: five.type, special: "rainbow" };
  }

  const four = groups.find(g => g.cells.length === 4);
  if (four) {
    const pos = preferredPos(four.cells, origin);
    return { ...pos, type: four.type, special: four.dir === "h" ? "h" : "v" };
  }
  return null;
}

function preferredPos(cells, origin) {
  return cells.find(pos => pos.r === origin?.r && pos.c === origin?.c) || cells[Math.floor(cells.length / 2)];
}

async function clearCells(clearSet, specialToCreate = null) {
  const expanded = expandSpecialClears(clearSet);
  expanded.forEach(k => {
    const [r, c] = k.split(",").map(Number);
    const tile = state.board[r][c];
    if (tile) flyGemToCauldron(r, c, tile.type);
  });
  markClearing(expanded);
  sfx("clear");
  await wait(260);
  expanded.forEach(k => {
    const [r, c] = k.split(",").map(Number);
    const tile = state.board[r][c];
    if (!tile) return;
    state.moveStats.cleared += 1;
    state.moveStats.potions[tile.type] += 1;
    state.orderPotions[tile.type] += 1;
    if (tile.special === "bomb") state.moveStats.usedExplosion = true;
    state.board[r][c] = null;
  });
  if (specialToCreate) {
    state.board[specialToCreate.r][specialToCreate.c] = makeTile(specialToCreate.type, specialToCreate.special);
    state.moveStats.createdSpecials.push(specialToCreate.special);
    sfx("special");
    cauldronAct(specialName(specialToCreate.special) + "煉成！", { glow: true });
  }
  renderPotions();
  updateResultPanel();
}

function expandSpecialClears(clearSet) {
  const out = new Set(clearSet);
  let changed = true;
  while (changed) {
    changed = false;
    [...out].forEach(k => {
      const [r, c] = k.split(",").map(Number);
      const tile = state.board[r][c];
      if (!tile?.special || tile.special === "rainbow") return;
      const before = out.size;
      addSpecialArea(out, r, c, tile.special);
      if (out.size > before) changed = true;
    });
  }
  return out;
}

function addSpecialArea(set, r, c, special) {
  if (special === "h") {
    for (let x = 0; x < SIZE; x++) set.add(key(r, x));
  } else if (special === "v") {
    for (let y = 0; y < SIZE; y++) set.add(key(y, c));
  } else if (special === "bomb") {
    state.moveStats.usedExplosion = true;
    for (let y = r - 1; y <= r + 1; y++) {
      for (let x = c - 1; x <= c + 1; x++) {
        if (inside(y, x)) set.add(key(y, x));
      }
    }
  }
}

function markClearing(set) {
  set.forEach(k => {
    const el = els.board.querySelector(`[data-r="${k.split(",")[0]}"][data-c="${k.split(",")[1]}"]`);
    if (el) el.classList.add("clearing");
  });
}

async function collapseAndRefill() {
  const oldRows = new Map();
  allCells().forEach(pos => {
    const tile = state.board[pos.r][pos.c];
    if (tile) oldRows.set(tile.id, pos.r);
  });
  const dropInfo = new Map();
  for (let c = 0; c < SIZE; c++) {
    const stack = [];
    for (let r = SIZE - 1; r >= 0; r--) {
      if (state.board[r][c]) stack.push(state.board[r][c]);
    }
    for (let r = SIZE - 1; r >= 0; r--) {
      if (stack.length) {
        const tile = stack.shift();
        state.board[r][c] = tile;
        const oldR = oldRows.get(tile.id) ?? r;
        const distance = r - oldR;
        if (distance > 0) {
          dropInfo.set(tile.id, { y: -distance * 48, delay: c * 10 + Math.max(0, distance - 1) * 14 });
        }
      } else {
        const tile = makeTile(biasedRefillType(r, c));
        state.board[r][c] = tile;
        dropInfo.set(tile.id, { y: -(r + 3) * 48, delay: c * 10 });
      }
    }
  }
  renderBoard(dropInfo);
  sfx("drop");
  await wait(380);
}

function getSpecialSwapResult(a, b) {
  const t1 = state.board[a.r][a.c];
  const t2 = state.board[b.r][b.c];
  if (!t1?.special && !t2?.special) return null;
  if (t1.special || t2.special) return { a: t1, b: t2 };
  return null;
}

async function resolveSpecialSwap(a, b, result) {
  state.moveStats.cascades += 1;
  const t1 = result.a;
  const t2 = result.b;
  const clearSet = new Set();
  const specialA = t1.special;
  const specialB = t2.special;
  const posA = a;
  const posB = b;

  if (specialA === "rainbow" && specialB === "rainbow") {
    allCells().forEach(pos => clearSet.add(key(pos.r, pos.c)));
    cauldronAct("雙彩虹魔石，清空全盤！", { glow: true });
  } else if (specialA === "rainbow" || specialB === "rainbow") {
    const rainbowPos = specialA === "rainbow" ? posA : posB;
    const other = specialA === "rainbow" ? t2 : t1;
    clearSet.add(key(rainbowPos.r, rainbowPos.c));
    if (other.special === "h" || other.special === "v" || other.special === "bomb") {
      transformColorToSpecial(other.type, other.special, clearSet);
      cauldronAct(`彩虹把${TYPE_LABEL[other.type]}符石變成${specialName(other.special)}！`, { glow: true });
    } else {
      allCells().filter(pos => state.board[pos.r][pos.c]?.type === other.type)
        .forEach(pos => clearSet.add(key(pos.r, pos.c)));
      cauldronAct(`彩虹清除全盤${TYPE_LABEL[other.type]}符石！`, { glow: true });
    }
  } else if (isLine(specialA) && isLine(specialB)) {
    for (let x = 0; x < SIZE; x++) clearSet.add(key(posA.r, x));
    for (let y = 0; y < SIZE; y++) clearSet.add(key(y, posA.c));
    cauldronAct("線 + 線：一列一欄切開盤面！", { glow: true });
  } else if ((isLine(specialA) && specialB === "bomb") || (specialA === "bomb" && isLine(specialB))) {
    for (let dy = -1; dy <= 1; dy++) {
      const row = posA.r + dy;
      if (row >= 0 && row < SIZE) for (let x = 0; x < SIZE; x++) clearSet.add(key(row, x));
    }
    for (let dx = -1; dx <= 1; dx++) {
      const col = posA.c + dx;
      if (col >= 0 && col < SIZE) for (let y = 0; y < SIZE; y++) clearSet.add(key(y, col));
    }
    state.moveStats.usedExplosion = true;
    cauldronAct("線 + 爆炸：多列多欄大掃除！", { glow: true });
  } else if (specialA === "bomb" && specialB === "bomb") {
    for (let y = posA.r - 2; y <= posA.r + 2; y++) {
      for (let x = posA.c - 2; x <= posA.c + 2; x++) if (inside(y, x)) clearSet.add(key(y, x));
    }
    state.moveStats.usedExplosion = true;
    cauldronAct("爆炸 + 爆炸：大範圍爆破！", { glow: true });
  } else {
    addSpecialArea(clearSet, posA.r, posA.c, specialA);
    addSpecialArea(clearSet, posB.r, posB.c, specialB);
  }

  clearSet.add(key(posA.r, posA.c));
  clearSet.add(key(posB.r, posB.c));
  await clearCells(clearSet);
  await collapseAndRefill();
  await resolveBoard(posA);
}

function transformColorToSpecial(type, special, clearSet) {
  const candidates = allCells().filter(pos => state.board[pos.r][pos.c]?.type === type);
  candidates.forEach((pos, index) => {
    if (index % 2 === 0) {
      state.board[pos.r][pos.c].special = special === "bomb" ? "bomb" : (index % 4 === 0 ? "h" : "v");
      addSpecialArea(clearSet, pos.r, pos.c, state.board[pos.r][pos.c].special);
    } else {
      clearSet.add(key(pos.r, pos.c));
    }
  });
}

function finalizeMove() {
  const stats = state.moveStats;
  const fullPotions = TYPES.filter(t => state.orderPotions[t] >= POTION_NEED);
  const smallMult = fullPotions.length
    ? Math.min(MAX_SMALL_WIN, .1 + fullPotions.length * .7 + stats.cleared * .08 + Math.max(0, stats.cascades - 1) * .35)
    : 0;
  stats.smallWin = Math.floor(state.bet * smallMult);

  const completed = checkOrderComplete();
  stats.orderWin = completed ? calculateOrderWin() : 0;
  state.coins += stats.smallWin + stats.orderWin;

  if (completed) {
    cauldronAct(`訂單完成！大獎 ${stats.orderWin} 金幣`, { glow: true, pop: true });
    sfx("jackpot");
    showOrderComplete(stats.orderWin, fullPotions);
    newOrder();
  } else {
    state.order.turns -= 1;
    if (state.order.turns <= 0) {
      cauldronAct("訂單逾期，刷新下一張");
      newOrder();
    }
  }

  const fullText = fullPotions.length ? fullPotions.map(t => TYPE_LABEL[t]).join("、") + "滿管" : "沒有滿管";
  setToast(`本手消除 ${stats.cleared} 顆，${fullText}，小獎 ${stats.smallWin}，訂單獎 ${stats.orderWin}。`);
  if (stats.smallWin > 0 || stats.orderWin > 0) celebrateWin(fullPotions, stats.orderWin > 0 ? 48 : 18, stats.orderWin > 0);
  if (stats.smallWin > 0) sfx("coin");
  updateResultPanel();
  renderAll();
}

function checkOrderComplete() {
  const stats = state.moveStats;
  const potionsOk = state.order.targets.every(t => state.orderPotions[t] >= POTION_NEED);
  const specialOk = !state.order.needSpecial || stats.createdSpecials.includes(state.order.needSpecial) || (state.order.needSpecial === "bomb" && stats.usedExplosion);
  const cascadeOk = stats.cascades >= state.order.minCascade;
  return potionsOk && specialOk && cascadeOk;
}

function calculateOrderWin() {
  const qualities = state.order.targets.map(t => state.orderPotions[t] / POTION_NEED);
  const quality = Math.min(3, Math.min(...qualities));
  return Math.floor(state.bet * state.order.multiplier * quality);
}

function newOrder() {
  resetOrderPotions();
  const twoTargets = shuffle([...TYPES]).slice(0, 2);
  const variants = [
    { targets: [randomType()], multiplier: randInt(5, 8), needSpecial: null, minCascade: 1 },
    { targets: twoTargets, multiplier: randInt(9, 14), needSpecial: null, minCascade: 1 },
    { targets: twoTargets, multiplier: randInt(12, 18), needSpecial: "bomb", minCascade: 1 },
    { targets: twoTargets, multiplier: randInt(13, 20), needSpecial: null, minCascade: 2 },
    { targets: shuffle([...TYPES]).slice(0, 3), multiplier: randInt(16, 24), needSpecial: "rainbow", minCascade: 1 }
  ];
  state.order = { ...variants[randInt(0, variants.length - 1)], turns: 5 };
}

function renderOrder() {
  const o = state.order;
  els.turnsLeft.textContent = `剩餘 ${o.turns} 手`;
  const targets = o.targets.map(t => `${TYPE_LABEL[t]}滿管`).join(" + ");
  const special = o.needSpecial ? (o.needSpecial === "bomb" ? "爆炸" : "彩虹") : "";
  const cascade = o.minCascade > 1 ? `${o.minCascade} 連鎖` : "";
  const extras = [special, cascade].filter(Boolean).join(" + ");
  const boost = getPotionBoost(o);
  const floor = getLowestTargetPotion(o);
  const estimate = Math.floor(state.bet * o.multiplier * boost);
  els.orderText.textContent = targets;
  els.orderMeta.innerHTML = `
    <span class="order-mult">${o.multiplier}x</span>
    <span class="order-times">×</span>
    <span class="order-boost">${boost.toFixed(1)}x</span>
    <span class="order-estimate">預估 ${estimate}</span>
    <span class="order-lowest">最低：${TYPE_LABEL[floor.type]} ${floor.amount}/${POTION_NEED}</span>
    ${extras ? `<span class="order-extra">${extras}</span>` : ""}
  `;
}

function getPotionBoost(order) {
  return Math.min(3, Math.min(...order.targets.map(t => state.orderPotions[t] / POTION_NEED)));
}

function getLowestTargetPotion(order) {
  return order.targets
    .map(type => ({ type, amount: state.orderPotions[type] }))
    .sort((a, b) => a.amount - b.amount)[0];
}

function renderPotions() {
  TYPES.forEach(type => {
    const amount = state.orderPotions[type] || 0;
    const pct = Math.min(220, amount / POTION_NEED * 100);
    const root = document.querySelector(`.potion.${type}`);
    root.querySelector(".fill").style.height = `${Math.min(100, pct)}%`;
    root.querySelector("b").textContent = `${amount}/${POTION_NEED}`;
  });
}

function resetOrderPotions() {
  state.orderPotions = Object.fromEntries(TYPES.map(t => [t, 0]));
}

function clearPotions() {
  resetOrderPotions();
  TYPES.forEach(type => {
    const root = document.querySelector(`.potion.${type}`);
    root.querySelector(".fill").style.height = "0%";
    root.querySelector("b").textContent = `0/${POTION_NEED}`;
  });
}

function updateResultPanel() {
  const stats = state.moveStats || {};
  els.clearedCount.textContent = stats.cleared || 0;
  els.cascadeCount.textContent = stats.cascades || 0;
  els.smallWin.textContent = stats.smallWin || 0;
  els.orderWin.textContent = stats.orderWin || 0;
}

function cauldronAct(text, opts = {}) {
  els.cauldronText.textContent = text;
  if (opts.pop) {
    els.cauldron.classList.remove("hot");
    void els.cauldron.offsetWidth;
    els.cauldron.classList.add("hot");
  }
  if (opts.glow || opts.pop) {
    els.cauldron.classList.add("jackpot");
    clearTimeout(cauldronGlowTimer);
    cauldronGlowTimer = setTimeout(() => els.cauldron.classList.remove("jackpot"), opts.pop ? 900 : 360);
  }
}

function setToast(text, duration = 2400) {
  els.toast.textContent = text;
  els.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove("visible");
  }, duration);
}

function flyGemToCauldron(r, c, type) {
  const tile = els.board.querySelector(`[data-r="${r}"][data-c="${c}"]`);
  if (!tile) return;
  const from = tile.getBoundingClientRect();
  const to = els.cauldron.getBoundingClientRect();
  const fly = document.createElement("span");
  fly.className = `fly gem ${type}`;
  fly.style.left = `${from.left + from.width / 2 - 12}px`;
  fly.style.top = `${from.top + from.height / 2 - 12}px`;
  fly.style.setProperty("--tx", `${to.left + to.width / 2}px`);
  fly.style.setProperty("--ty", `${to.top + to.height / 2}px`);
  document.body.appendChild(fly);
  fly.addEventListener("animationend", () => fly.remove());
}

function burstCoins(count, big = false) {
  els.coinBurst.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const coin = document.createElement("span");
    coin.className = `coin-pop${big ? " big" : ""}`;
    coin.style.setProperty("--x", `${randInt(big ? -210 : -168, big ? 210 : 168)}px`);
    coin.style.setProperty("--y", `${randInt(big ? -210 : -150, big ? 110 : 82)}px`);
    coin.style.setProperty("--size", `${randInt(big ? 18 : 14, big ? 32 : 24)}px`);
    coin.style.setProperty("--rot", `${randInt(-420, 420)}deg`);
    coin.style.animationDelay = `${i * (big ? 6 : 10)}ms`;
    els.coinBurst.appendChild(coin);
  }
}

function celebrateWin(types, coinCount, isOrder = false) {
  cauldronAct("藥水沸騰，金幣出鍋！", { glow: true, pop: true });
  if (isOrder) {
    els.cauldron.classList.remove("super");
    void els.cauldron.offsetWidth;
    els.cauldron.classList.add("super");
    setTimeout(() => els.cauldron.classList.remove("super"), 980);
  }
  burstCoins(Math.max(coinCount, isOrder ? 56 : 24), isOrder);
  types.forEach(type => {
    const root = document.querySelector(`.potion.${type}`);
    root?.classList.remove("win", "super-win");
    void root?.offsetWidth;
    root?.classList.add(isOrder ? "super-win" : "win");
    setTimeout(() => root?.classList.remove("win", "super-win"), isOrder ? 980 : 620);
  });
}

function showOrderComplete(amount, types) {
  els.bigWinAmount.textContent = `+${amount}`;
  els.bigWin.classList.remove("show");
  els.shell.classList.remove("win-flash");
  void els.shell.offsetWidth;
  els.shell.classList.add("win-flash");
  void els.bigWin.offsetWidth;
  els.bigWin.classList.add("show");
  setTimeout(() => els.bigWin.classList.remove("show"), 1450);
  setTimeout(() => els.shell.classList.remove("win-flash"), 900);
  types.forEach(type => {
    const root = document.querySelector(`.potion.${type}`);
    root?.classList.add("super-win");
  });
}

function allCells() {
  const cells = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) cells.push({ r, c });
  return cells;
}

function key(r, c) { return `${r},${c}`; }
function inside(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }
function isLine(s) { return s === "h" || s === "v"; }
function specialName(s) {
  return ({ h: "橫向線型符石", v: "縱向線型符石", bomb: "爆炸符石", rainbow: "彩虹魔石" })[s] || "特殊符石";
}
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

els.bet.addEventListener("change", () => {
  state.bet = Number(els.bet.value);
  setToast(`BET 調整為 ${state.bet}`);
});
els.newGame.addEventListener("click", init);
els.soundToggle.addEventListener("click", () => {
  sound.enabled = !sound.enabled;
  els.soundToggle.classList.toggle("muted", !sound.enabled);
  els.soundToggle.textContent = sound.enabled ? "♪" : "×";
  if (sound.enabled) sfx("tap");
});
init();
