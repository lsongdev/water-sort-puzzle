const CAPACITY = 4;
const LAYER_PERCENT = 22;
const COLOR_NAMES = ['珊瑚红', '蜂蜜黄', '湖水蓝', '薄荷绿', '鸢尾紫', '莓果粉', '琥珀橙', '冰川青'];
const $ = selector => document.querySelector(selector);
const board = $('#bottleBoard');
const moveCount = $('#moveCount');
const levelNumber = $('#levelNumber');
const message = $('#message');
const undoButton = $('#undoButton');
const winDialog = $('#winDialog');

let level = Number(localStorage.getItem('water-sort-level')) || 1;
let bottles = [];
let initialBottles = [];
let selected = null;
let moves = 0;
let history = [];
let soundEnabled = true;
let audioContext;
let animating = false;

function seededRandom(seed) {
  let value = seed % 2147483647;
  return () => ((value = value * 16807 % 2147483647) - 1) / 2147483646;
}

function generatePuzzle(currentLevel) {
  const colorCount = Math.min(4 + Math.floor((currentLevel - 1) / 2), 8);
  const tubes = Array.from({ length: colorCount }, (_, color) => Array(CAPACITY).fill(color));
  tubes.push([], []);
  const random = seededRandom(currentLevel * 92821 + 17);
  let lastMove = null;
  for (let step = 0; step < 90 + currentLevel * 2; step++) {
    const options = [];
    tubes.forEach((source, from) => {
      if (!source.length) return;
      const color = source.at(-1);
      let group = 1;
      while (group < source.length && source[source.length - 1 - group] === color) group++;
      tubes.forEach((target, to) => {
        if (from === to || target.length >= CAPACITY) return;
        if (lastMove && lastMove.from === to && lastMove.to === from) return;
        if (!target.length || target.at(-1) !== color) {
          // Reverse a legal forward move. When another color sits underneath,
          // leave one matching layer behind so the reverse path stays valid.
          const reversibleGroup = source.length > group ? group - 1 : group;
          const maxAmount = Math.min(reversibleGroup, CAPACITY - target.length);
          for (let amount = 1; amount <= maxAmount; amount++) options.push({ from, to, amount });
        }
      });
    });
    if (!options.length) { lastMove = null; continue; }
    const choice = options[Math.floor(random() * options.length)];
    tubes[choice.to].push(...tubes[choice.from].splice(-choice.amount));
    lastMove = choice;
  }
  return tubes;
}

const cloneState = state => state.map(bottle => [...bottle]);

function startLevel(nextLevel = level) {
  level = nextLevel;
  localStorage.setItem('water-sort-level', String(level));
  bottles = generatePuzzle(level);
  initialBottles = cloneState(bottles);
  selected = null;
  moves = 0;
  history = [];
  winDialog.hidden = true;
  message.textContent = '选择一个瓶子开始';
  render();
}

function render() {
  levelNumber.textContent = String(level).padStart(2, '0');
  moveCount.textContent = moves;
  undoButton.disabled = history.length === 0;
  board.innerHTML = '';
  bottles.forEach((contents, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `bottle-wrap${selected === index ? ' selected' : ''}`;
    const topColor = contents.length ? COLOR_NAMES[contents.at(-1)] : '';
    button.setAttribute('aria-label', contents.length ? `第 ${index + 1} 个瓶子，顶层是${topColor}，共 ${contents.length} 层` : `第 ${index + 1} 个瓶子，空瓶`);
    button.setAttribute('aria-pressed', selected === index ? 'true' : 'false');
    const glass = document.createElement('span');
    glass.className = 'bottle';
    contents.forEach((color, liquidIndex) => {
      const liquid = document.createElement('span');
      liquid.className = `liquid color-${color}${liquidIndex === contents.length - 1 ? ' top' : ''}`;
      glass.append(liquid);
    });
    const lips = document.createElement('span');
    lips.className = 'bottle-lips';
    button.append(glass, lips);
    button.addEventListener('click', () => handleBottleClick(index, button));
    board.append(button);
  });
}

function topGroup(bottle) {
  if (!bottle.length) return { count: 0 };
  const color = bottle.at(-1);
  let count = 1;
  while (count < bottle.length && bottle[bottle.length - 1 - count] === color) count++;
  return { count };
}

function canPour(from, to) {
  if (from === to || !bottles[from].length || bottles[to].length === CAPACITY) return false;
  return !bottles[to].length || bottles[to].at(-1) === bottles[from].at(-1);
}

async function handleBottleClick(index, element) {
  if (animating) return;
  if (selected === null) {
    if (!bottles[index].length) return reject(element, '这个瓶子是空的');
    selected = index;
    message.textContent = '现在选择要倒入的瓶子';
    playTone(410, .04);
    return render();
  }
  if (selected === index) {
    selected = null;
    message.textContent = '已取消选择';
    return render();
  }
  if (!canPour(selected, index)) {
    return reject(element, bottles[index].length === CAPACITY ? '这个瓶子已经满了' : '只能倒在相同颜色上');
  }
  const sourceIndex = selected;
  history.push({ bottles: cloneState(bottles), moves });
  const { count } = topGroup(bottles[sourceIndex]);
  const amount = Math.min(count, CAPACITY - bottles[index].length);
  const color = bottles[sourceIndex].at(-1);
  animating = true;
  board.classList.add('is-pouring');
  message.textContent = `正在倒入 ${amount} 层颜色…`;
  playTone(540, .12);
  try {
    await animatePour(sourceIndex, index, amount, color);
  } finally {
    animating = false;
    board.classList.remove('is-pouring');
  }
  bottles[index].push(...bottles[sourceIndex].splice(-amount));
  moves++;
  selected = null;
  message.textContent = `倒入了 ${amount} 层颜色`;
  render();
  if (isSolved()) setTimeout(showWin, 380);
}

async function animatePour(from, to, amount, color) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const source = board.children[from];
  const target = board.children[to];
  if (!source || !target) return;

  const sourceRect = source.getBoundingClientRect();
  const sourceBottleRect = source.querySelector('.bottle').getBoundingClientRect();
  const targetBottleRect = target.querySelector('.bottle').getBoundingClientRect();
  const sourceMouth = {
    x: sourceBottleRect.left + sourceBottleRect.width / 2,
    y: sourceBottleRect.top + 4,
  };
  const targetMouth = {
    x: targetBottleRect.left + targetBottleRect.width / 2,
    y: targetBottleRect.top + 4,
  };
  const streamHeight = 56;
  const direction = targetMouth.x >= sourceMouth.x ? 'right' : 'left';
  const anchor = document.createElement('span');
  anchor.className = `mouth-anchor mouth-anchor-${direction}`;
  source.querySelector('.bottle').append(anchor);
  const anchorRect = anchor.getBoundingClientRect();
  const pivot = {
    x: sourceMouth.x - sourceRect.left,
    y: sourceMouth.y - sourceRect.top,
  };
  const lip = {
    x: anchorRect.left + anchorRect.width / 2 - sourceRect.left,
    y: anchorRect.top + anchorRect.height / 2 - sourceRect.top,
  };
  source.style.setProperty('--mouth-x', `${pivot.x}px`);
  source.style.setProperty('--mouth-y', `${pivot.y}px`);
  source.classList.add('pouring', `pouring-${direction}`);
  target.classList.add('receiving');

  const angle = direction === 'right' ? 66 : -66;
  const radians = angle * Math.PI / 180;
  const relativeLip = { x: lip.x - pivot.x, y: lip.y - pivot.y };
  const rotatedLip = {
    x: relativeLip.x * Math.cos(radians) - relativeLip.y * Math.sin(radians),
    y: relativeLip.x * Math.sin(radians) + relativeLip.y * Math.cos(radians),
  };
  const start = { x: 0, y: -15 };
  const base = { x: sourceRect.left, y: sourceRect.top - start.y };
  const end = {
    x: targetMouth.x - (base.x + pivot.x + rotatedLip.x),
    y: targetMouth.y - streamHeight - (base.y + pivot.y + rotatedLip.y),
  };
  const lift = Math.min(96, 48 + Math.abs(end.x) * .16);
  const control = {
    x: (start.x + end.x) / 2,
    y: Math.min(start.y, end.y) - lift,
  };

  source.style.transform = transformAt(start, 0);
  await animateCurve(source, start, control, end, 0, angle, 360);

  const streamStart = { x: targetMouth.x, y: targetMouth.y - streamHeight };
  const stream = document.createElement('span');
  const topLiquid = source.querySelector('.liquid.top');
  stream.className = 'pour-stream';
  stream.style.left = `${streamStart.x - 4}px`;
  stream.style.top = `${streamStart.y}px`;
  stream.style.height = `${Math.max(8, targetMouth.y - streamStart.y)}px`;
  stream.style.backgroundColor = topLiquid ? getComputedStyle(topLiquid).backgroundColor : '#76bfc2';
  document.body.append(stream);

  await animateLiquidTransfer(source, target, amount, color, 440 + amount * 70);
  stream.classList.add('ending');
  await wait(130);
  stream.remove();
  await animateCurve(source, end, control, start, angle, 0, 310);

  anchor.remove();
  source.style.removeProperty('transform');
  source.classList.remove('pouring', `pouring-${direction}`);
  target.classList.remove('receiving');
  source.style.removeProperty('--mouth-x');
  source.style.removeProperty('--mouth-y');
}

function transformAt(point, angle) {
  return `translate(${point.x}px, ${point.y}px) rotate(${angle}deg)`;
}

function animateCurve(element, start, control, end, startAngle, endAngle, duration) {
  return animateFrames(duration, progress => {
    const eased = progress < .5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    const inverse = 1 - eased;
    const point = {
      x: inverse * inverse * start.x + 2 * inverse * eased * control.x + eased * eased * end.x,
      y: inverse * inverse * start.y + 2 * inverse * eased * control.y + eased * eased * end.y,
    };
    element.style.transform = transformAt(point, startAngle + (endAngle - startAngle) * eased);
  });
}

function animateLiquidTransfer(source, target, amount, color, duration) {
  const sourceLayers = Array.from(source.querySelectorAll('.liquid')).slice(-amount).reverse();
  const targetBottle = target.querySelector('.bottle');
  const incomingLayers = Array.from({ length: amount }, () => {
    const layer = document.createElement('span');
    layer.className = `liquid transfer-in color-${color}`;
    layer.style.flexBasis = '0%';
    targetBottle.append(layer);
    return layer;
  });

  return animateFrames(duration, progress => {
    const volume = (1 - Math.cos(Math.PI * progress)) / 2 * amount;
    sourceLayers.forEach((layer, index) => {
      const transferred = Math.min(1, Math.max(0, volume - index));
      layer.style.flexBasis = `${LAYER_PERCENT * (1 - transferred)}%`;
      layer.style.opacity = String(Math.min(1, (1 - transferred) * 4));
      layer.classList.toggle('top', index === Math.min(amount - 1, Math.floor(volume)) && transferred < 1);
    });
    incomingLayers.forEach((layer, index) => {
      const transferred = Math.min(1, Math.max(0, volume - index));
      layer.style.flexBasis = `${LAYER_PERCENT * transferred}%`;
      layer.classList.toggle('top', index === Math.min(amount - 1, Math.floor(volume)));
    });
  });
}

function animateFrames(duration, draw) {
  return new Promise(resolve => {
    const startedAt = performance.now();
    const frame = now => {
      const progress = Math.min(1, (now - startedAt) / duration);
      draw(progress);
      if (progress < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function reject(element, text) {
  message.textContent = text;
  element.classList.remove('shake');
  requestAnimationFrame(() => element.classList.add('shake'));
  playTone(180, .07);
}

function isSolved() {
  return bottles.every(bottle => !bottle.length || (bottle.length === CAPACITY && bottle.every(color => color === bottle[0])));
}

function showWin() {
  $('#finalMoves').textContent = moves;
  winDialog.hidden = false;
  playWinSound();
  $('#nextLevelButton').focus();
}

function resetCurrent() {
  bottles = cloneState(initialBottles);
  selected = null;
  moves = 0;
  history = [];
  winDialog.hidden = true;
  message.textContent = '关卡已重新开始';
  render();
}

undoButton.addEventListener('click', () => {
  if (animating) return;
  const previous = history.pop();
  if (!previous) return;
  bottles = previous.bottles;
  moves = previous.moves;
  selected = null;
  message.textContent = '已撤销上一步';
  playTone(330, .05);
  render();
});
$('#restartButton').addEventListener('click', () => !animating && resetCurrent());
$('#replayButton').addEventListener('click', () => !animating && resetCurrent());
$('#newGameButton').addEventListener('click', () => !animating && startLevel(level + 1));
$('#nextLevelButton').addEventListener('click', () => !animating && startLevel(level + 1));
$('#soundButton').addEventListener('click', event => {
  soundEnabled = !soundEnabled;
  event.currentTarget.setAttribute('aria-pressed', String(soundEnabled));
  event.currentTarget.setAttribute('aria-label', soundEnabled ? '关闭音效' : '开启音效');
  if (soundEnabled) playTone(520, .05);
});

function playTone(frequency, duration) {
  if (!soundEnabled) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(.035, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch (_) { /* Audio is optional. */ }
}

function playWinSound() {
  [520, 660, 820].forEach((tone, index) => setTimeout(() => playTone(tone, .13), index * 110));
}

startLevel();
