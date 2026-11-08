import bcrypt from "bcryptjs";
import * as readline from "readline/promises";
import { stdin, stdout } from "process";
import {
  audit,
  countUsers,
  ensureSchema,
  getUserByUsername,
  pool,
  saveUser,
} from "./db";

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function readPipedLines(): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
}

function askHidden(question: string): Promise<string> {
  if (!stdin.isTTY) return ask(question);
  stdout.write(question);
  return new Promise((resolve) => {
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\n" || char === "\r") {
          stdin.setRawMode(wasRaw);
          stdin.pause();
          stdin.removeListener("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        if (char >= " ") {
          value += char;
          stdout.write("*");
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  const command = (process.argv[2] || "create-admin").toLowerCase();
  if (!["create-admin", "reset-password"].includes(command)) {
    console.error(
      "Usage:\n  npm run create-admin\n  npm run reset-admin\n\nPrompts for username, password, and confirmation.",
    );
    process.exitCode = 1;
    return;
  }

  await ensureSchema();
  const users = await countUsers();
  if (command === "reset-password" && users === 0) {
    throw new Error("No admin users exist yet. Run `npm run create-admin` first.");
  }

  const pipedLines = stdin.isTTY ? null : await readPipedLines();
  const typed = stdin.isTTY
    ? await ask("Username: ")
    : pipedLines?.[0]?.trim() || "";
  const username = typed.toLowerCase();
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    throw new Error("Username must be 3-64 characters: letters, numbers, dot, underscore, or dash.");
  }

  const existing = await getUserByUsername(username);
  if (command === "create-admin" && existing) {
    throw new Error(
      `User "${existing.username}" already exists. Use \`npm run reset-admin\` to change its password.`,
    );
  }
  if (command === "reset-password" && !existing) {
    throw new Error(`User "${username}" does not exist. Use \`npm run create-admin\` first.`);
  }

  let password: string;
  let confirm: string;
  if (stdin.isTTY) {
    password = await askHidden("Password: ");
    confirm = await askHidden("Confirm password: ");
  } else {
    password = pipedLines?.[1] || "";
    confirm = pipedLines?.[2] || "";
  }
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  if (password !== confirm) {
    throw new Error("Passwords do not match.");
  }

  const hash = await bcrypt.hash(password, 12);
  await saveUser(username, hash);
  await audit("cli", command, username);
  console.log(
    `Admin user "${username}" ${existing ? "updated" : "created"} successfully. You can now sign in.`,
  );
}

main()
  .catch((error) => {
    console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
