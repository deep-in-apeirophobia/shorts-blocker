// Random puzzles have one solution and require more than naked/hidden singles.
const ALL = 0x3fe;
const units = [];
for (let n = 0; n < 9; n++) {
  units.push(Array.from({ length: 9 }, (_, i) => n * 9 + i));
  units.push(Array.from({ length: 9 }, (_, i) => i * 9 + n));
  units.push(Array.from({ length: 9 }, (_, i) =>
    (Math.floor(n / 3) * 3 + Math.floor(i / 3)) * 9 + (n % 3) * 3 + i % 3));
}
const peers = Array.from({ length: 81 }, (_, cell) =>
  [...new Set(units.filter(unit => unit.includes(cell)).flat())].filter(i => i !== cell));

function shuffle(values) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function candidates(grid, cell) {
  let mask = ALL;
  for (const peer of peers[cell]) mask &= ~(1 << grid[peer]);
  return Array.from({ length: 9 }, (_, i) => i + 1).filter(n => mask & (1 << n));
}

function validGrid(grid) {
  return Array.isArray(grid) && grid.length === 81 &&
    grid.every(n => Number.isInteger(n) && n >= 0 && n <= 9) &&
    units.every(unit => {
      const digits = unit.map(i => grid[i]).filter(Boolean);
      return new Set(digits).size === digits.length;
    });
}

function search(grid, limit, random = false) {
  let cell = -1;
  let options = [];
  for (let i = 0; i < 81; i++) {
    if (grid[i]) continue;
    const available = candidates(grid, i);
    if (!available.length) return { count: 0 };
    if (cell === -1 || available.length < options.length) {
      cell = i;
      options = available;
      if (options.length === 1) break;
    }
  }
  if (cell === -1) return { count: 1, solution: [...grid] };
  let count = 0;
  let solution;
  for (const digit of random ? shuffle(options) : options) {
    grid[cell] = digit;
    const result = search(grid, limit - count, random);
    count += result.count;
    solution ??= result.solution;
    if (count >= limit) break;
  }
  grid[cell] = 0;
  return { count, solution };
}

export function countSolutions(givens) {
  return validGrid(givens) ? search([...givens], 2).count : 0;
}

export function isSinglesSolvable(givens) {
  if (!validGrid(givens)) return false;
  const grid = [...givens];
  while (grid.includes(0)) {
    const options = grid.map((value, cell) => value ? [] : candidates(grid, cell));
    let cell = options.findIndex(values => values.length === 1);
    let digit = cell >= 0 ? options[cell][0] : 0;
    if (cell < 0) {
      outer: for (const unit of units) {
        for (let n = 1; n <= 9; n++) {
          const places = unit.filter(i => options[i].includes(n));
          if (places.length === 1) { cell = places[0]; digit = n; break outer; }
        }
      }
    }
    if (cell < 0) return false;
    grid[cell] = digit;
  }
  return true;
}

export function isSolution(puzzle, solution) {
  const givens = Array.isArray(puzzle) ? puzzle : puzzle?.givens;
  return validGrid(givens) && validGrid(solution) && !solution.includes(0) &&
    givens.every((digit, i) => digit === 0 || solution[i] === digit);
}

export function generatePuzzle() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const givens = search(Array(81).fill(0), 1, true).solution;
    let clues = 81;
    for (const cell of shuffle(Array.from({ length: 81 }, (_, i) => i))) {
      const digit = givens[cell];
      givens[cell] = 0;
      if (countSolutions(givens) !== 1) givens[cell] = digit;
      else clues--;
      if (clues <= 26 && !isSinglesSolvable(givens)) return { givens };
    }
  }
  throw new Error('Could not create a hard puzzle. Please try again.');
}
