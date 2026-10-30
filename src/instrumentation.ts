export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startBackgroundTasks } = await import('./lib/background');
    startBackgroundTasks();
  }
}
