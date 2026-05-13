export * from "./db";
export * from "./agent";
export * from "./replay";

if (require.main === module) {
  const prompt =
    process.argv.slice(2).join(" ") || "Use SearchDocs to find documentation for dAVM frame replay.";

  void import("./agent")
    .then(({ runAgentDemo }) => runAgentDemo(prompt))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
