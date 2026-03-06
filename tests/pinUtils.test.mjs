import test from "node:test";
import assert from "node:assert/strict";
import {
  addPinnedId,
  removePinnedId,
  togglePinnedId,
  transferPinnedId,
} from "../src/context/pinUtils.js";

test("addPinnedId adds missing id once", () => {
  assert.deepEqual(addPinnedId(["a"], "b"), ["a", "b"]);
  assert.deepEqual(addPinnedId(["a", "b"], "b"), ["a", "b"]);
});

test("removePinnedId removes id and leaves others", () => {
  assert.deepEqual(removePinnedId(["a", "b", "c"], "b"), ["a", "c"]);
  assert.deepEqual(removePinnedId(["a"], "x"), ["a"]);
});

test("togglePinnedId toggles membership", () => {
  assert.deepEqual(togglePinnedId(["a"], "b"), ["a", "b"]);
  assert.deepEqual(togglePinnedId(["a", "b"], "b"), ["a"]);
});

test("transferPinnedId moves rename id and preserves order", () => {
  assert.deepEqual(
    transferPinnedId(["a", "old", "c"], "old", "new"),
    ["a", "new", "c"],
  );
  assert.deepEqual(transferPinnedId(["a"], "missing", "new"), ["a"]);
  assert.deepEqual(transferPinnedId(["a", "b"], "b", "b"), ["a", "b"]);
});

