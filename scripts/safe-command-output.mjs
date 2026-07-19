import { spawn } from "node:child_process";

/**
 * @param {string} output
 * @returns {string}
 */
export function redactSensitiveOutput(output) {
  return output.replace(/(https?:\/\/[^\s"'<>?]+)\?[^\s"'<>]+/g, "$1?[redacted]");
}

/**
 * @param {(chunk: string) => void} write
 * @returns {{ push: (chunk: string) => void; flush: () => void }}
 */
function createRedactedLineWriter(write) {
  let pending = "";

  return {
    push(chunk) {
      pending += chunk;
      const lines = pending.split(/\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        write(`${redactSensitiveOutput(line)}\n`);
      }
    },
    flush() {
      if (!pending) return;
      write(redactSensitiveOutput(pending));
      pending = "";
    },
  };
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<void>}
 */
export function runCommandRedacted(command, args) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    let safeStderr = "";
    const stdout = createRedactedLineWriter((chunk) => process.stdout.write(chunk));
    const stderr = createRedactedLineWriter((chunk) => {
      safeStderr = `${safeStderr}${chunk}`.slice(-8_192);
      process.stderr.write(chunk);
    });

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr.push(chunk);
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      stdout.flush();
      stderr.flush();

      if (signal) reject(new Error(`${command} stopped by signal ${signal}`));
      else if (code !== 0) {
        const error = new Error(`${command} exited with code ${code}`);
        Object.defineProperty(error, "safeStderr", {
          value: safeStderr,
          enumerable: false,
          writable: false,
        });
        reject(error);
      }
      else resolveExit(undefined);
    });
  });
}
