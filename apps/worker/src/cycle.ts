// O ciclo vive no núcleo compartilhado para que a API possa embuti-lo em desenvolvimento (PGlite, processo único).
export { runCycle, runMaintenance, startWorkerLoop, type CycleResult } from '@ada/api/cycle';
