const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');
const { copyFile, mkdir } = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const start = '// SLP system bar migration BEGIN';
const end = '// SLP system bar migration END';

module.exports = function withSystemBars(config) {
  config = withAppBuildGradle(config, (mod) => {
    const source = mod.modResults.contents;
    const block = `${start}\n${readFileSync(path.join(__dirname, 'system-bars/system-bars.gradle'), 'utf8')}${end}`;
    const first = source.indexOf(start);
    if (first < 0) {
      mod.modResults.contents = `${source.trimEnd()}\n\n${block}\n`;
    } else {
      const last = source.indexOf(end, first);
      if (last < 0) throw new Error('Incomplete SLP system bar migration block');
      mod.modResults.contents = source.slice(0, first) + block + source.slice(last + end.length);
    }
    return mod;
  });
  return withDangerousMod(config, ['android', async (mod) => {
    const app = path.join(mod.modRequest.platformProjectRoot, 'app');
    const sources = path.join(app, 'src/main/java/dev/heonhwi/slpai');
    const resources = path.join(app, 'src/main/res/values');
    await mkdir(sources, { recursive: true });
    await mkdir(resources, { recursive: true });
    await copyFile(path.join(__dirname, 'system-bars/SystemBarProtection.kt'), path.join(sources, 'SystemBarProtection.kt'));
    await copyFile(path.join(__dirname, 'system-bars/ids.xml'), path.join(resources, 'slp_system_bars.xml'));
    return mod;
  }]);
};
