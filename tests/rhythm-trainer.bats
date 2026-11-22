#!/usr/bin/env bats
# =============================================================================
# Rhythm Trainer
# Copyright (c) 2026 Proximity Software Factory LLC. All rights reserved.
#
# This file is part of Rhythm Trainer. Proprietary and confidential.
# Unauthorized copying, modification, or distribution is strictly prohibited.
# See LICENSE for details.
# =============================================================================
# the pure rules (node's test runner), the page's script parses, and the page keeps no state and loads nothing
# from the network.

WEB="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"

setup() { export HOME="$(mktemp -d)"; }
teardown() { rm -rf "$HOME"; }

@test "the rules pass their node tests" {
  run node --test "$WEB/tests/tempo-core.test.js"
  [ "$status" -eq 0 ]
  [[ "$output" == *"fail 0"* ]]
}

@test "the page's inline script parses" {
  run node -e "const h=require('fs').readFileSync('$WEB/index.html','utf8');new Function(h.split('<script>')[1].split('</script>')[0]);"
  [ "$status" -eq 0 ]
}

@test "the page keeps no state" {
  run grep -E "localStorage|sessionStorage|indexedDB|document\.cookie" "$WEB/index.html" "$WEB/tempo-core.js"
  [ "$status" -eq 1 ]
}

@test "the page loads nothing from the network" {
  run grep -E "(src|href)=\"https?:|fetch\(" "$WEB/index.html"
  [ "$status" -eq 1 ]
}

@test "the core loads as a browser script too" {
  run node -e "const vm=require('vm');const c={};vm.createContext(c);vm.runInContext(require('fs').readFileSync('$WEB/tempo-core.js','utf8'),c);if(!c.TT||!c.TT.yin)process.exit(1)"
  [ "$status" -eq 0 ]
}
