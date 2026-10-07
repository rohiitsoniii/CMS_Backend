/**
 * Safety guards for one-off database scripts (seeders, promotions).
 * `npm run seed` against a production database must never wipe data by
 * accident: destructive scripts refuse to run without explicit consent.
 */
export const assertScriptSafe = (options: {
  scriptName: string;
  destructive: boolean;
}): void => {
  const args = process.argv.slice(2);

  if (process.env.NODE_ENV === 'production' && !args.includes('--force')) {
    console.error(
      `❌ Refusing to run ${options.scriptName} in production without --force. ` +
        `If you really mean it: npm run ${options.scriptName} -- --force`
    );
    process.exit(1);
  }

  if (options.destructive && !args.includes('--yes') && process.env.NODE_ENV !== 'test') {
    console.error(
      `❌ ${options.scriptName} deletes data. Re-run with --yes to confirm ` +
        `(e.g. npx tsx src/scripts/${options.scriptName}.ts --yes).`
    );
    process.exit(1);
  }
};
