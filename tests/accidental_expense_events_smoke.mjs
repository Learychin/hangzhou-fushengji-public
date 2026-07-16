import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GameEngine } = require("../minigame/src/engine/game-engine.js");

const game = new GameEngine();
game.cash = 1000;
game.debt = 0;
game.stealEvents = [{
  freq: 1,
  msg: "测试用意外支出事件。",
  ratio: 50,
  min: 1500,
  max: 1500,
  severity: "heavy",
  debtOnShortfall: true,
}];

game.doStealEvents();

const event = game.eventLog.find((row) => row.event_type === "expense_event");
assert.ok(event, "expense_event should be recorded");
assert.equal(game.cash, 0);
assert.ok(game.debt > 0, "cash shortfall should create debt when configured");
assert.equal(event.payload.loss, 1000);
assert.equal(event.payload.desired_loss, 1500);
assert.ok(event.payload.debt_added > 0);
assert.equal(event.payload.severity, "heavy");
assert.equal(event.payload.source, "测试用意外支出事件。");

console.log("accidental expense events smoke ok");
