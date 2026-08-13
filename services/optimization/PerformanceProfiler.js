/**
 * PerformanceProfiler — Module de mesure fine du temps d'exécution
 * Mesure chaque étape du pipeline de traduction de manière isolée et déterministe.
 */
class PerformanceProfiler {
  constructor(jobId = 'job') {
    this.jobId = jobId;
    this.startTime = Date.now();
    this.marks = {};
    this.durations = {};
    this.mark('start');
  }

  mark(stepName) {
    const now = Date.now();
    this.marks[stepName] = now;
    return now;
  }

  endStep(stepName, startMark = 'start') {
    const now = Date.now();
    const startTime = this.marks[startMark] || this.startTime;
    const elapsed = now - startTime;
    this.durations[stepName] = (this.durations[stepName] || 0) + elapsed;
    this.marks[startMark] = now; // Réinitialise le point de départ pour l'étape suivante
    return elapsed;
  }

  getSummary() {
    const totalMs = Date.now() - this.startTime;
    const formatDuration = (ms) => {
      if (!ms || ms <= 0) return '0 ms';
      if (ms < 1000) return `${ms} ms`;
      const sec = (ms / 1000).toFixed(2);
      return `${sec} s`;
    };

    const formattedSteps = {};
    for (const [step, ms] of Object.entries(this.durations)) {
      const pct = totalMs > 0 ? ((ms / totalMs) * 100).toFixed(1) : '0.0';
      formattedSteps[step] = {
        ms,
        formatted: formatDuration(ms),
        percent: `${pct}%`
      };
    }

    return {
      jobId: this.jobId,
      totalMs,
      totalFormatted: formatDuration(totalMs),
      steps: formattedSteps
    };
  }

  printSummaryConsole() {
    const summary = this.getSummary();
    console.log('='.repeat(50));
    console.log(` PROFILING PERFORMANCE PIPELINE [Job: ${summary.jobId}]`);
    console.log('='.repeat(50));
    for (const [step, info] of Object.entries(summary.steps)) {
      console.log(`${step.padEnd(25)} : ${info.formatted.padEnd(10)} (${info.percent})`);
    }
    console.log('-'.repeat(50));
    console.log(`TOTAL                     : ${summary.totalFormatted}`);
    console.log('='.repeat(50));
  }
}

module.exports = PerformanceProfiler;
