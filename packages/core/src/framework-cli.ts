// Entry point of detect.cjs, the bundled copy of framework.ts that the AWS build script runs (so the same code
// decides on a laptop and in CodeBuild). Usage, from the project folder:
//   node detect.cjs detect            before building: prints {"framework","label","outputDirs"}, or a reason and exit 1
//   node detect.cjs resolve           after building: prints {"framework","out","routing"} (routing is "" for a SPA)
//   node detect.cjs hint <log file>   prints extra advice for a failed build, if there is any
import * as fs from 'node:fs';
import { detectProject, detectRouting, findOutputDir, hintForBuildFailure } from './framework.js';
import * as path from 'node:path';

const [command, arg] = process.argv.slice(2);
try {
  const dir = process.cwd();
  if (command === 'detect') {
    console.log(JSON.stringify(detectProject(dir)));
  } else if (command === 'resolve') {
    const kind = detectProject(dir);
    const out = findOutputDir(dir, kind);
    console.log(JSON.stringify({ framework: kind.framework, out: path.relative(dir, out), routing: detectRouting(out, kind) ?? '' }));
  } else if (command === 'hint') {
    const log = fs.readFileSync(arg ?? '', 'utf8').slice(-20000);
    process.stdout.write(hintForBuildFailure(log));
  } else {
    throw new Error(`Unknown command "${command}".`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
