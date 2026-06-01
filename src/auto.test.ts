import assert from "node:assert";

import { describe, it } from "node:test";

import {
  aborts,
  assistant,
  responds,
  pushTask,
  status,
  task,
  taskResult,
  user,
  userCtrlC,
  userEsc,
  userPrompts,
  TestHarness,
} from "./test-helpers/index.js";

describe("automated workflow", () => {
  it("completes push-task -> /auto -> finish-task and injects the branch result", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("main work", responds("working on main..."));
    h.llm.onPrompt("Analyze performance.", responds("Found 3 bottlenecks: ..."));
    h.llm.onPrompt("Found 3 bottlenecks: ...", responds(""));
    h.llm.onPrompt("working on main...", responds(""));
    h.llm.onPrompt("queue analyze", pushTask("Analyze performance."));
    try {
      await h.prompt("main work");
      await h.prompt("queue analyze");

      await h.prompt("/auto");

      h.assertSession(
        status(),
        user("main work"),
        assistant("working on main..."),
        user("queue analyze"),
        assistant("", "toolUse"),
        task("Analyze performance."),
        status("pending task: analyze-performance"),
        status("[auto] pending task: analyze-performance"),
        status("pending task: analyze-performance"),
        status(),
        taskResult("analyze-performance", "Found 3 bottlenecks: ..."),
        assistant(""),
      );
    } finally {
      h.dispose();
    }
  });

  it("returns the branch result to the original leaf for branch-context tasks", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("main work", responds("working..."));
    h.llm.onPrompt("Quick fix.", responds("Fixed the bug."));
    h.llm.onPrompt("Fixed the bug.", responds(""));
    h.llm.onPrompt("working...", responds(""));
    h.llm.onPrompt("queue quick-fix", pushTask("Quick fix.", true));
    try {
      await h.prompt("main work");
      await h.prompt("queue quick-fix");

      await h.prompt("/auto");

      h.assertSession(
        user("main work"),
        assistant("working..."),
        user("queue quick-fix"),
        assistant("", "toolUse"),
        task("Quick fix.", true),
        status("pending task: quick-fix"),
        status("[auto] pending task: quick-fix"),
        status("pending task: quick-fix"),
        status(),
        taskResult("quick-fix", "Fixed the bug."),
        assistant(""),
      );
    } finally {
      h.dispose();
    }
  });

  it("stops when navigation is cancelled and does not mark the task done", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("main work", responds(""));
    h.llm.onPrompt("queue analyze", pushTask("Analyze performance."));
    h.user.onQueuedTask("Analyze performance.", userEsc());
    try {
      await h.prompt("main work");
      await h.prompt("queue analyze");

      await h.prompt("/auto");

      h.assertSession(
        user("main work"),
        assistant(""),
        user("queue analyze"),
        assistant("", "toolUse"),
        task("Analyze performance."),
        status("pending task: analyze-performance"),
        status("[auto] pending task: analyze-performance"),
        status("pending task: analyze-performance"),
      );
    } finally {
      h.dispose();
    }
  });

  it("notifies and exits when started with no pending tasks", async () => {
    const h = await TestHarness.create();
    try {
      await h.prompt("/auto");
      h.assertSession();
      assert.strictEqual(h.lastNotification(), "No pending tasks to run.");
    } finally {
      h.dispose();
    }
  });

  it("warns and returns when /auto is already running", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("start", responds(""));
    h.llm.onPrompt("first task", responds("done"));
    h.llm.onPrompt("done", responds(""));
    h.llm.onPrompt("queue first", pushTask("first task"));
    h.user.onAssistant("done", userPrompts("/auto"));
    try {
      await h.prompt("start");
      await h.prompt("queue first");

      await h.prompt("/auto");

      h.assertSession(
        status(),
        user("start"),
        assistant(""),
        user("queue first"),
        assistant("", "toolUse"),
        task("first task"),
        status("pending task: first-task"),
        status("[auto] pending task: first-task"),
        status("pending task: first-task"),
        status(),
        taskResult("first-task", "done"),
        assistant(""),
      );
    } finally {
      h.dispose();
    }
  });

  it("stops when the last assistant message was aborted", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("start", responds(""));
    h.llm.onPrompt("", responds(""));
    h.llm.onPrompt("Implement phase 1.", aborts("Stopped by user."));
    h.llm.onPrompt("queue implement", pushTask("Implement phase 1.", true));
    try {
      await h.prompt("start");
      await h.prompt("queue implement");

      await h.prompt("/auto");

      h.assertSession(
        user("start"),
        assistant(""),
        user("queue implement"),
        assistant("", "toolUse"),
        task("Implement phase 1.", true),
        status("pending task: implement-phase-1"),
        status("[auto] pending task: implement-phase-1"),
        user("Implement phase 1."),
        assistant("Stopped by user.", "aborted"),
        status("current task: implement-phase-1"),
      );
    } finally {
      h.dispose();
    }
  });

  it("processes a subtask pushed during a task", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("main work", responds("working..."));
    h.llm.onPrompt("", responds(""));
    h.llm.onPrompt("parent task", responds("working on parent..."), pushTask("subtask"));
    h.llm.onPrompt("subtask", responds("sub done"));
    h.llm.onPrompt("sub done", responds(""));
    h.llm.onPrompt("working on parent...", responds(""));
    h.llm.onPrompt("queue parent", pushTask("parent task"));
    try {
      await h.prompt("main work");
      await h.prompt("queue parent");

      await h.prompt("/auto");

      // Current branch shows the parent task result
      h.assertSession(
        status(),
        user("main work"),
        assistant("working..."),
        user("queue parent"),
        assistant("", "toolUse"),
        task("parent task"),
        status("pending task: parent-task"),
        status("[auto] pending task: parent-task"),
        status("pending task: parent-task"),
        status(),
        taskResult("parent-task"),
        assistant(""),
      );
      // The subtask entries should be in the whole-session history
      h.assertSessionContains(
        user("subtask"),
        assistant("sub done"),
        taskResult("subtask", "sub done"),
      );
    } finally {
      h.dispose();
    }
  });

  it("continues processing when user queues a steering message during auto", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("start", responds(""));
    h.llm.onPrompt("", responds(""));
    h.llm.onPrompt("Quick fix.", responds("thinking..."));
    h.llm.onPrompt("steer it", responds("adjusted response"));
    h.llm.onPrompt("adjusted response", responds(""));
    h.llm.onPrompt("queue quick-fix", pushTask("Quick fix.", true));
    h.user.onAssistant("thinking...", userPrompts("steer it"));
    try {
      await h.prompt("start");
      await h.prompt("queue quick-fix");

      await h.prompt("/auto");

      h.assertSession(
        user("start"),
        assistant(""),
        user("queue quick-fix"),
        assistant("", "toolUse"),
        task("Quick fix.", true),
        status("pending task: quick-fix"),
        status("[auto] pending task: quick-fix"),
        status("pending task: quick-fix"),
        status(),
        taskResult("quick-fix", "adjusted response"),
        assistant(""),
      );
    } finally {
      h.dispose();
    }
  });

  it("stops when session is shut down during auto", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("start", responds(""));
    h.llm.onPrompt("", responds(""));
    h.llm.onPrompt("Shutdown task", responds("working..."));
    h.llm.onPrompt("queue shutdown", pushTask("Shutdown task", true));
    h.user.onAssistant("working...", userCtrlC());
    try {
      await h.prompt("start");
      await h.prompt("queue shutdown");

      await h.prompt("/auto");

      h.assertSession(
        user("start"),
        assistant(""),
        user("queue shutdown"),
        assistant("", "toolUse"),
        task("Shutdown task", true),
        status("pending task: shutdown-task"),
        status("[auto] pending task: shutdown-task"),
        user("Shutdown task"),
        assistant("working..."),
        status("current task: shutdown-task"),
      );
    } finally {
      h.dispose();
    }
  });
});
