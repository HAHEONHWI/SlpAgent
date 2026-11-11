const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

test('prebuild migration is idempotent and preserves other Gradle configuration', () => {
  let modify;
  const context = {
    module: { exports: {} },
    __dirname,
    require: (name) => name === 'expo/config-plugins' ? {
      withAppBuildGradle: (config, action) => { modify = action; return config; },
      withDangerousMod: (config) => config,
    } : require(name),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'with-system-bars.js'), 'utf8'), context);
  context.module.exports({});
  const apply = (contents) => modify({ modResults: { contents } }).modResults.contents;
  const initial = apply('apply plugin: "com.android.application"\n');
  assert.equal(apply(initial), initial);
  const withOtherPlugin = initial + '\nandroid { lint { abortOnError true } }\n';
  assert.equal(apply(withOtherPlugin), withOtherPlugin);
  const stale = initial.replace('class SlpSystemBarsVisitor', 'class OldVisitor');
  assert.equal(apply(stale), initial);
  assert.throws(() => apply('// SLP system bar migration BEGIN\n'), /Incomplete SLP/);
});
