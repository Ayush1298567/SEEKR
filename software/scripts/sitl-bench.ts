import { runSitlBench } from "../src/flight";

const result = runSitlBench();
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
