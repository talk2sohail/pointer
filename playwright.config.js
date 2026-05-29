export default {
  testDir: "./tests",
  timeout: 30000,
  retries: 0,
  workers: 4,
  use: {
    headless: false,
    launchOptions: {
      args: ["--no-sandbox"],
    },
  },
};
