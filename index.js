const CAPACITY = 4;
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
    button.append(glass);
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
  animating = true;
  board.classList.add('is-pouring');
  message.textContent = `正在倒入 ${amount} 层颜色…`;
  playTone(540, .12);
  try {
    await animatePour(sourceIndex, index);
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

async function animatePour(from, to) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const source = board.children[from];
  const target = board.children[to];
  if (!source || !target) return;

  const sourceRect = source.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const sourceCenter = sourceRect.left + sourceRect.width / 2;
  const targetCenter = targetRect.left + targetRect.width / 2;
  const direction = targetCenter >= sourceCenter ? 'right' : 'left';
  source.style.setProperty('--pour-x', `${targetCenter - sourceCenter}px`);
  source.style.setProperty('--pour-y', `${targetRect.top - sourceRect.top - 58}px`);
  source.classList.add('pouring', `pouring-${direction}`);
  target.classList.add('receiving');

  await wait(210);
  const stream = document.createElement('span');
  const topLiquid = source.querySelector('.liquid.top');
  stream.className = 'pour-stream';
  stream.style.left = `${targetCenter - 4}px`;
  stream.style.top = `${targetRect.top - 53}px`;
  stream.style.backgroundColor = topLiquid ? getComputedStyle(topLiquid).backgroundColor : '#76bfc2';
  document.body.append(stream);

  await wait(330);
  stream.classList.add('ending');
  await wait(150);
  stream.remove();
  source.classList.remove('pouring', `pouring-${direction}`);
  target.classList.remove('receiving');
  source.style.removeProperty('--pour-x');
  source.style.removeProperty('--pour-y');
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
