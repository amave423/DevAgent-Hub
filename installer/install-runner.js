const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");

class InstallCommandRunner extends EventEmitter {
  constructor({ steps, env = process.env }) {
    super();
    this.steps = steps;
    this.env = env;
    this.cancelRequested = false;
    this.currentProcess = null;
  }

  cancel() {
    this.cancelRequested = true;
    if (this.currentProcess) {
      this.currentProcess.kill();
    }
  }

  async run() {
    this.emitEvent({ type: "run-start", totalSteps: this.steps.length });

    try {
      for (const [index, step] of this.steps.entries()) {
        if (this.cancelRequested) {
          throw new InstallCancelledError();
        }

        await this.runStep(step, index);
      }

      this.emitEvent({ type: "run-complete", totalSteps: this.steps.length });
      return { ok: true };
    } catch (error) {
      if (error instanceof InstallCancelledError || this.cancelRequested) {
        this.emitEvent({ type: "run-cancelled", message: "Установка отменена" });
        return { ok: false, cancelled: true };
      }

      this.emitEvent({
        type: "run-failed",
        message: error.message,
        stepId: error.stepId,
        label: error.label,
        exitCode: error.exitCode,
      });
      throw error;
    } finally {
      this.currentProcess = null;
    }
  }

  runStep(step, index) {
    return new Promise((resolve, reject) => {
      this.emitEvent({
        type: "step-start",
        stepId: step.id,
        label: step.label,
        index,
        totalSteps: this.steps.length,
        command: formatCommand(step),
      });

      const child = spawn(step.command, step.args, {
        cwd: step.cwd,
        env: { ...this.env, ...(step.env ?? {}) },
        shell: false,
        windowsHide: true,
      });

      this.currentProcess = child;

      child.stdout.on("data", (chunk) => {
        this.emitEvent({
          type: "stdout",
          stepId: step.id,
          label: step.label,
          message: chunk.toString(),
        });
      });

      child.stderr.on("data", (chunk) => {
        this.emitEvent({
          type: "stderr",
          stepId: step.id,
          label: step.label,
          message: chunk.toString(),
        });
      });

      child.on("error", (error) => {
        reject(stepError(step, error.message, null));
      });

      child.on("close", (code) => {
        this.currentProcess = null;

        if (this.cancelRequested) {
          reject(new InstallCancelledError());
          return;
        }

        if (code === 0) {
          this.emitEvent({
            type: "step-complete",
            stepId: step.id,
            label: step.label,
            index,
            totalSteps: this.steps.length,
            exitCode: code,
          });
          resolve();
          return;
        }

        reject(stepError(step, `Команда завершилась с кодом ${code}`, code));
      });
    });
  }

  emitEvent(event) {
    this.emit("event", {
      ...event,
      timestamp: new Date().toISOString(),
    });
  }
}

class InstallCancelledError extends Error {
  constructor() {
    super("Установка отменена");
    this.name = "InstallCancelledError";
  }
}

function stepError(step, message, exitCode) {
  const error = new Error(message);
  error.stepId = step.id;
  error.label = step.label;
  error.exitCode = exitCode;
  return error;
}

function formatCommand(step) {
  return [step.command, ...step.args.map(quoteArg)].join(" ");
}

function quoteArg(arg) {
  const text = String(arg);
  if (!/[\s"]/u.test(text)) return text;
  return `"${text.replaceAll('"', '\\"')}"`;
}

module.exports = {
  InstallCommandRunner,
};
