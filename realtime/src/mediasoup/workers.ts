import * as mediasoup from "mediasoup";
import type { Worker } from "mediasoup/types";
import { workerSettings, NUM_WORKERS } from "../config.js";

const workers: Worker[] = [];
let nextWorkerIdx = 0;

export async function createWorkers(): Promise<void> {
  for (let i = 0; i < NUM_WORKERS; i++) {
    const worker = await mediasoup.createWorker(workerSettings);

    worker.on("died", (error) => {
      console.error(`mediasoup Worker died [pid:${worker.pid}]`, error);
      process.exit(1);
    });

    workers.push(worker);
    console.log(`mediasoup Worker created [pid:${worker.pid}] (${i + 1}/${NUM_WORKERS})`);
  }
}

export function getNextWorker(): Worker {
  if (workers.length === 0) {
    throw new Error("No mediasoup workers available");
  }
  const worker = workers[nextWorkerIdx];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
}
