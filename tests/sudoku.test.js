import assert from "node:assert/strict";
import test from "node:test";

import {
  countSolutions,
  generatePuzzle,
  isSinglesSolvable,
  isSolution,
} from "../sudoku.js";

const solvedGrid = [
  5, 3, 4, 6, 7, 8, 9, 1, 2,
  6, 7, 2, 1, 9, 5, 3, 4, 8,
  1, 9, 8, 3, 4, 2, 5, 6, 7,
  8, 5, 9, 7, 6, 1, 4, 2, 3,
  4, 2, 6, 8, 5, 3, 7, 9, 1,
  7, 1, 3, 9, 2, 4, 8, 5, 6,
  9, 6, 1, 5, 3, 7, 2, 8, 4,
  2, 8, 7, 4, 1, 9, 6, 3, 5,
  3, 4, 5, 2, 8, 6, 1, 7, 9,
];

test("generated puzzles are sparse, unique, and require more than singles", () => {
  const { givens } = generatePuzzle();
  const clueCount = givens.filter(Boolean).length;

  assert.equal(givens.length, 81);
  assert.ok(clueCount >= 17 && clueCount <= 26, `expected 17-26 clues, received ${clueCount}`);
  assert.equal(countSolutions(givens), 1);
  assert.equal(isSinglesSolvable(givens), false);
});

test("successive generated puzzles differ", () => {
  const signatures = new Set(
    Array.from({ length: 3 }, () => generatePuzzle().givens.join("")),
  );

  assert.equal(signatures.size, 3);
});

test("solution validation honors every given clue", () => {
  const givens = solvedGrid.map((digit, index) => index % 3 === 0 ? digit : 0);
  assert.equal(isSolution(givens, solvedGrid), true);
  assert.equal(isSolution({ givens }, solvedGrid), true);

  const changedGiven = [...givens];
  changedGiven[0] = 4;
  assert.equal(isSolution(changedGiven, solvedGrid), false);
});

test("solution validation rejects incomplete and invalid grids", () => {
  const givens = Array(81).fill(0);
  const incomplete = [...solvedGrid];
  incomplete[80] = 0;
  const duplicate = [...solvedGrid];
  duplicate[80] = 1;

  assert.equal(isSolution(givens, incomplete), false);
  assert.equal(isSolution(givens, duplicate), false);
});
