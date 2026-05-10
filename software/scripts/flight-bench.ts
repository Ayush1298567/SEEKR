import { runFlightBench } from "../src/flight";

const result = runFlightBench();
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
