"use strict";
// The recipe-model validator now lives in the shared package, so the harness
// and the product cannot drift apart: packages/recipe-core/src/recipe-adjust.js.
//
// This file stays as the harness's entry point because the 13 recorded
// expectations in tests/recipe-model/adjustments/ are what proves the move was
// behaviour-preserving, and because `eval.js` has required it since M1. What it
// scores is now the shipped code rather than a copy of it.

const { validate } = require("../../packages/recipe-core/src/recipe-adjust");

module.exports = { validate };
