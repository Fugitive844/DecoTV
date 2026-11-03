const fs = require('fs'),
  path = require('path'),
  ts = require('typescript'),
  Module = require('module');
const file = path.resolve('src/lib/ip-location.ts');
const m = new Module(file, module);
m.filename = file;
m.paths = Module._nodeModulePaths(path.dirname(file));
m._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText,
  file,
);
(async () => {
  const ips = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const result = {};
  for (const ip of ips)
    result[ip] = await m.exports.resolveIpLocation(
      new Headers({ 'x-real-ip': ip }),
    );
  fs.writeFileSync(process.argv[3], JSON.stringify(result));
  console.log(
    JSON.stringify({
      resolved: ips.length,
      states: [...new Set(Object.values(result).map((v) => v.status))],
    }),
  );
})();
