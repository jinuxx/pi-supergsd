import assert from 'node:assert';

import {
  assistant,
  node,
  responds,
  task,
  taskResult,
  user,
} from './test-helpers/index.js';

import { describe } from 'node:test';

describe('manual workflow', () => {
  node('push AAA', async (h) => {
    await h.prompt('main work', responds('working...'));
    await h.runPushTask('Task AAA');
    assert.strictEqual(h.getStatus(), 'pending task: task-aaa');
    h.assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('Task AAA'),
    );
    h.assertNotifications('Task stored. Use `/start-task` or `/auto` to start it.');
  }).children(
    node('discard AAA', async (h) => {
      await h.runDiscardTask();
      assert.strictEqual(h.getStatus(), undefined);
      h.assertBranchHistory(
        user('main work'),
        assistant('working...'),
        task('Task AAA'),
      );
      h.assertNotifications('Task discarded.');
    }),
    node('start AAA', async (h) => {
      await h.runStartTask();
      assert.strictEqual(h.getStatus(), 'current task: task-aaa');
      h.assertBranchHistory(
        user('Task AAA'),
      );
    }).children(
      node('finish AAA', async (h) => {
        await h.prompt('continue', responds('Done.'));
        await h.runFinishTask();
        assert.strictEqual(h.getStatus(), undefined);
        h.assertBranchHistory(
          user('main work'),
          assistant('working...'),
          task('Task AAA'),
          taskResult('task-aaa', 'Done.'),
        );
        h.assertNotifications('Task finished. Last response attached.');
      }).children(
        node('start [no task]', async (h) => {
          await h.runStartTask();
          assert.strictEqual(h.getStatus(), undefined);
          h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            task('Task AAA'),
            taskResult('task-aaa', 'Done.'),
          );
          h.assertNotifications('No pending task. Use push-task first.');
        }),
        node('discard [no task]', async (h) => {
          await h.runDiscardTask();
          assert.strictEqual(h.getStatus(), undefined);
          h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            task('Task AAA'),
            taskResult('task-aaa', 'Done.'),
          );
          h.assertNotifications('No pending task to discard.');
        }),
        node('finish [no task]', async (h) => {
          await h.runFinishTask();
          assert.strictEqual(h.getStatus(), undefined);
          h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            task('Task AAA'),
            taskResult('task-aaa', 'Done.'),
          );
          h.assertNotifications('Not inside task, nothing to finish.');
        }),
        node('abort [no task]', async (h) => {
          await h.runAbortTask();
          assert.strictEqual(h.getStatus(), undefined);
          h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            task('Task AAA'),
            taskResult('task-aaa', 'Done.'),
          );
          h.assertNotifications('Not inside task, nothing to abort.');
        }),
      ),
      node('abort AAA', async (h) => {
        await h.prompt('continue', responds('Partial...'));
        await h.runAbortTask();
        assert.strictEqual(h.getStatus(), 'pending task: task-aaa');
        h.assertBranchHistory(
          user('main work'),
          assistant('working...'),
          task('Task AAA'),
        );
        h.assertNotifications('Task aborted. Branch abandoned without summary.');
      }).children(
        node('start AAA', async (h) => {
          await h.runStartTask();
          assert.strictEqual(h.getStatus(), 'current task: task-aaa');
          h.assertBranchHistory(
            user('Task AAA'),
          );
        }).children(
          node('finish AAA', async (h) => {
            await h.prompt('continue', responds('Done.'));
            await h.runFinishTask();
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user('main work'),
              assistant('working...'),
              task('Task AAA'),
              taskResult('task-aaa', 'Done.'),
            );
            h.assertNotifications('Task finished. Last response attached.');
          }),
        ),
      ),
      node('push BBB', async (h) => {
        await h.prompt('continue', responds('some more work'));
        await h.runPushTask('Task BBB');
        assert.strictEqual(h.getStatus(), 'pending task: task-bbb');
        h.assertBranchHistory(
          user('Task AAA'),
          user('continue'),
          assistant('some more work'),
          task('Task BBB'),
        );
        h.assertNotifications('Task stored. Use `/start-task` or `/auto` to start it.');
      }).children(
        node('discard BBB', async (h) => {
          await h.runDiscardTask();
          assert.strictEqual(h.getStatus(), 'current task: task-aaa');
          h.assertBranchHistory(
            user('Task AAA'),
            user('continue'),
            assistant('some more work'),
            task('Task BBB'),
          );
          h.assertNotifications('Task discarded.');
        }).children(
          node('finish AAA', async (h) => {
            await h.prompt('continue', responds('Done.'));
            await h.runFinishTask();
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user('main work'),
              assistant('working...'),
              task('Task AAA'),
              taskResult('task-aaa', 'Done.'),
            );
            h.assertNotifications('Task finished. Last response attached.');
          }),
        ),
        node('start BBB', async (h) => {
          await h.runStartTask();
          assert.strictEqual(h.getStatus(), 'current task: task-bbb');
          h.assertBranchHistory(
            user('Task BBB'),
          );
        }).children(
          node('finish BBB', async (h) => {
            await h.prompt('continue', responds('inner done'));
            await h.runFinishTask();
            assert.strictEqual(h.getStatus(), 'current task: task-aaa');
            h.assertBranchHistory(
              user('Task AAA'),
              user('continue'),
              assistant('some more work'),
              task('Task BBB'),
              taskResult('task-bbb', 'inner done'),
            );
            h.assertNotifications('Task finished. Last response attached.');
          }).children(
            node('finish AAA', async (h) => {
              await h.prompt('continue', responds('Done.'));
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user('main work'),
                assistant('working...'),
                task('Task AAA'),
                taskResult('task-aaa', 'Done.'),
              );
              h.assertNotifications('Task finished. Last response attached.');
            }),
          ),
          node('abort BBB', async (h) => {
            await h.prompt('continue', responds('partial inner'));
            await h.runAbortTask();
            assert.strictEqual(h.getStatus(), 'pending task: task-bbb');
            h.assertBranchHistory(
              user('Task AAA'),
              user('continue'),
              assistant('some more work'),
              task('Task BBB'),
            );
            h.assertNotifications('Task aborted. Branch abandoned without summary.');
          }).children(
            node('finish AAA', async (h) => {
              await h.prompt('continue', responds('Done.'));
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user('main work'),
                assistant('working...'),
                task('Task AAA'),
                taskResult('task-aaa', 'Done.'),
              );
              h.assertNotifications('Task finished. Last response attached.');
            }),
          ),
        ),
      ),
      node('push BBB [inherit]', async (h) => {
        await h.prompt('continue', responds('some more work'));
        await h.runPushTask('Task BBB', true);
        assert.strictEqual(h.getStatus(), 'pending task: task-bbb');
        h.assertBranchHistory(
          user('Task AAA'),
          user('continue'),
          assistant('some more work'),
          task('Task BBB', true),
        );
        h.assertNotifications('Task stored. Use `/start-task` or `/auto` to start it.');
      }).children(
        node('discard BBB [inherit]', async (h) => {
          await h.runDiscardTask();
          assert.strictEqual(h.getStatus(), 'current task: task-aaa');
          h.assertBranchHistory(
            user('Task AAA'),
            user('continue'),
            assistant('some more work'),
            task('Task BBB', true),
          );
          h.assertNotifications('Task discarded.');
        }).children(
          node('finish AAA', async (h) => {
            await h.prompt('continue', responds('Done.'));
            await h.runFinishTask();
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user('main work'),
              assistant('working...'),
              task('Task AAA'),
              taskResult('task-aaa', 'Done.'),
            );
            h.assertNotifications('Task finished. Last response attached.');
          }),
        ),
        node('start BBB [inherit]', async (h) => {
          await h.runStartTask();
          assert.strictEqual(h.getStatus(), 'current task: task-bbb');
          h.assertBranchHistory(
            user('Task AAA'),
            user('continue'),
            assistant('some more work'),
            task('Task BBB', true),
            user('Task BBB'),
          );
        }).children(
          node('finish BBB [inherit]', async (h) => {
            await h.prompt('continue', responds('inner done'));
            await h.runFinishTask();
            assert.strictEqual(h.getStatus(), 'current task: task-aaa');
            h.assertBranchHistory(
              user('Task AAA'),
              user('continue'),
              assistant('some more work'),
              task('Task BBB', true),
              taskResult('task-bbb', 'inner done'),
            );
            h.assertNotifications('Task finished. Last response attached.');
          }).children(
            node('finish AAA', async (h) => {
              await h.prompt('continue', responds('Done.'));
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user('main work'),
                assistant('working...'),
                task('Task AAA'),
                taskResult('task-aaa', 'Done.'),
              );
              h.assertNotifications('Task finished. Last response attached.');
            }),
          ),
          node('abort BBB [inherit]', async (h) => {
            await h.prompt('continue', responds('partial inner'));
            await h.runAbortTask();
            assert.strictEqual(h.getStatus(), 'pending task: task-bbb');
            h.assertBranchHistory(
              user('Task AAA'),
              user('continue'),
              assistant('some more work'),
              task('Task BBB', true),
            );
            h.assertNotifications('Task aborted. Branch abandoned without summary.');
          }).children(
            node('finish AAA', async (h) => {
              await h.prompt('continue', responds('Done.'));
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user('main work'),
                assistant('working...'),
                task('Task AAA'),
                taskResult('task-aaa', 'Done.'),
              );
              h.assertNotifications('Task finished. Last response attached.');
            }),
          ),
        ),
      ),
    ),
  ).run();

  node('push AAA [inherit]', async (h) => {
    await h.prompt('main work', responds('working...'));
    await h.runPushTask('Task AAA', true);
    assert.strictEqual(h.getStatus(), 'pending task: task-aaa');
    h.assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('Task AAA', true),
    );
    h.assertNotifications('Task stored. Use `/start-task` or `/auto` to start it.');
  }).children(
    node('discard AAA', async (h) => {
      await h.runDiscardTask();
      assert.strictEqual(h.getStatus(), undefined);
      h.assertBranchHistory(
        user('main work'),
        assistant('working...'),
        task('Task AAA', true),
      );
      h.assertNotifications('Task discarded.');
    }),
    node('start AAA', async (h) => {
      await h.runStartTask();
      assert.strictEqual(h.getStatus(), 'current task: task-aaa');
      h.assertBranchHistory(
        user('main work'),
        assistant('working...'),
        task('Task AAA', true),
        user('Task AAA'),
      );
    }).children(
      node('finish AAA', async (h) => {
        await h.prompt('continue', responds('Done.'));
        await h.runFinishTask();
        assert.strictEqual(h.getStatus(), undefined);
        h.assertBranchHistory(
          user('main work'),
          assistant('working...'),
          task('Task AAA', true),
          taskResult('task-aaa', 'Done.'),
        );
        h.assertNotifications('Task finished. Last response attached.');
      }).children(
        node('start [no task]', async (h) => {
          await h.runStartTask();
          assert.strictEqual(h.getStatus(), undefined);
          h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            task('Task AAA', true),
            taskResult('task-aaa', 'Done.'),
          );
          h.assertNotifications('No pending task. Use push-task first.');
        }),
        node('discard [no task]', async (h) => {
          await h.runDiscardTask();
          assert.strictEqual(h.getStatus(), undefined);
          h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            task('Task AAA', true),
            taskResult('task-aaa', 'Done.'),
          );
          h.assertNotifications('No pending task to discard.');
        }),
        node('finish [no task]', async (h) => {
          await h.runFinishTask();
          assert.strictEqual(h.getStatus(), undefined);
          h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            task('Task AAA', true),
            taskResult('task-aaa', 'Done.'),
          );
          h.assertNotifications('Not inside task, nothing to finish.');
        }),
        node('abort [no task]', async (h) => {
          await h.runAbortTask();
          assert.strictEqual(h.getStatus(), undefined);
          h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            task('Task AAA', true),
            taskResult('task-aaa', 'Done.'),
          );
          h.assertNotifications('Not inside task, nothing to abort.');
        }),
      ),
      node('abort AAA', async (h) => {
        await h.prompt('continue', responds('Partial...'));
        await h.runAbortTask();
        assert.strictEqual(h.getStatus(), 'pending task: task-aaa');
        h.assertBranchHistory(
          user('main work'),
          assistant('working...'),
          task('Task AAA', true),
        );
        h.assertNotifications('Task aborted. Branch abandoned without summary.');
      }).children(
        node('start AAA', async (h) => {
          await h.runStartTask();
          assert.strictEqual(h.getStatus(), 'current task: task-aaa');
          h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            task('Task AAA', true),
            user('Task AAA'),
          );
        }).children(
          node('finish AAA', async (h) => {
            await h.prompt('continue', responds('Done.'));
            await h.runFinishTask();
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user('main work'),
              assistant('working...'),
              task('Task AAA', true),
              taskResult('task-aaa', 'Done.'),
            );
            h.assertNotifications('Task finished. Last response attached.');
          }),
        ),
      ),
      node('push BBB', async (h) => {
        await h.prompt('continue', responds('some more work'));
        await h.runPushTask('Task BBB');
        assert.strictEqual(h.getStatus(), 'pending task: task-bbb');
        h.assertBranchHistory(
          user('main work'),
          assistant('working...'),
          task('Task AAA', true),
          user('Task AAA'),
          user('continue'),
          assistant('some more work'),
          task('Task BBB'),
        );
        h.assertNotifications('Task stored. Use `/start-task` or `/auto` to start it.');
      }).children(
        node('discard BBB', async (h) => {
          await h.runDiscardTask();
          assert.strictEqual(h.getStatus(), 'current task: task-aaa');
          h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            task('Task AAA', true),
            user('Task AAA'),
            user('continue'),
            assistant('some more work'),
            task('Task BBB'),
          );
          h.assertNotifications('Task discarded.');
        }).children(
          node('finish AAA', async (h) => {
            await h.prompt('continue', responds('Done.'));
            await h.runFinishTask();
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user('main work'),
              assistant('working...'),
              task('Task AAA', true),
              taskResult('task-aaa', 'Done.'),
            );
            h.assertNotifications('Task finished. Last response attached.');
          }),
        ),
        node('start BBB', async (h) => {
          await h.runStartTask();
          assert.strictEqual(h.getStatus(), 'current task: task-bbb');
          h.assertBranchHistory(
            user('Task BBB'),
          );
        }).children(
          node('finish BBB', async (h) => {
            await h.prompt('continue', responds('inner done'));
            await h.runFinishTask();
            assert.strictEqual(h.getStatus(), 'current task: task-aaa');
            h.assertBranchHistory(
              user('main work'),
              assistant('working...'),
              task('Task AAA', true),
              user('Task AAA'),
              user('continue'),
              assistant('some more work'),
              task('Task BBB'),
              taskResult('task-bbb', 'inner done'),
            );
            h.assertNotifications('Task finished. Last response attached.');
          }).children(
            node('finish AAA', async (h) => {
              await h.prompt('continue', responds('Done.'));
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user('main work'),
                assistant('working...'),
                task('Task AAA', true),
                taskResult('task-aaa', 'Done.'),
              );
              h.assertNotifications('Task finished. Last response attached.');
            }),
          ),
          node('abort BBB', async (h) => {
            await h.prompt('continue', responds('partial inner'));
            await h.runAbortTask();
            assert.strictEqual(h.getStatus(), 'pending task: task-bbb');
            h.assertBranchHistory(
              user('main work'),
              assistant('working...'),
              task('Task AAA', true),
              user('Task AAA'),
              user('continue'),
              assistant('some more work'),
              task('Task BBB'),
            );
            h.assertNotifications('Task aborted. Branch abandoned without summary.');
          }).children(
            node('finish AAA', async (h) => {
              await h.prompt('continue', responds('Done.'));
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user('main work'),
                assistant('working...'),
                task('Task AAA', true),
                taskResult('task-aaa', 'Done.'),
              );
              h.assertNotifications('Task finished. Last response attached.');
            }),
          ),
        ),
      ),
      node('push BBB [inherit]', async (h) => {
        await h.prompt('continue', responds('some more work'));
        await h.runPushTask('Task BBB', true);
        assert.strictEqual(h.getStatus(), 'pending task: task-bbb');
        h.assertBranchHistory(
          user('main work'),
          assistant('working...'),
          task('Task AAA', true),
          user('Task AAA'),
          user('continue'),
          assistant('some more work'),
          task('Task BBB', true),
        );
        h.assertNotifications('Task stored. Use `/start-task` or `/auto` to start it.');
      }).children(
        node('discard BBB [inherit]', async (h) => {
          await h.runDiscardTask();
          assert.strictEqual(h.getStatus(), 'current task: task-aaa');
          h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            task('Task AAA', true),
            user('Task AAA'),
            user('continue'),
            assistant('some more work'),
            task('Task BBB', true),
          );
          h.assertNotifications('Task discarded.');
        }).children(
          node('finish AAA', async (h) => {
            await h.prompt('continue', responds('Done.'));
            await h.runFinishTask();
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user('main work'),
              assistant('working...'),
              task('Task AAA', true),
              taskResult('task-aaa', 'Done.'),
            );
            h.assertNotifications('Task finished. Last response attached.');
          }),
        ),
        node('start BBB [inherit]', async (h) => {
          await h.runStartTask();
          assert.strictEqual(h.getStatus(), 'current task: task-bbb');
          h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            task('Task AAA', true),
            user('Task AAA'),
            user('continue'),
            assistant('some more work'),
            task('Task BBB', true),
            user('Task BBB'),
          );
        }).children(
          node('finish BBB [inherit]', async (h) => {
            await h.prompt('continue', responds('inner done'));
            await h.runFinishTask();
            assert.strictEqual(h.getStatus(), 'current task: task-aaa');
            h.assertBranchHistory(
              user('main work'),
              assistant('working...'),
              task('Task AAA', true),
              user('Task AAA'),
              user('continue'),
              assistant('some more work'),
              task('Task BBB', true),
              taskResult('task-bbb', 'inner done'),
            );
            h.assertNotifications('Task finished. Last response attached.');
          }).children(
            node('finish AAA', async (h) => {
              await h.prompt('continue', responds('Done.'));
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user('main work'),
                assistant('working...'),
                task('Task AAA', true),
                taskResult('task-aaa', 'Done.'),
              );
              h.assertNotifications('Task finished. Last response attached.');
            }),
          ),
          node('abort BBB [inherit]', async (h) => {
            await h.prompt('continue', responds('partial inner'));
            await h.runAbortTask();
            assert.strictEqual(h.getStatus(), 'pending task: task-bbb');
            h.assertBranchHistory(
              user('main work'),
              assistant('working...'),
              task('Task AAA', true),
              user('Task AAA'),
              user('continue'),
              assistant('some more work'),
              task('Task BBB', true),
            );
            h.assertNotifications('Task aborted. Branch abandoned without summary.');
          }).children(
            node('finish AAA', async (h) => {
              await h.prompt('continue', responds('Done.'));
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user('main work'),
                assistant('working...'),
                task('Task AAA', true),
                taskResult('task-aaa', 'Done.'),
              );
              h.assertNotifications('Task finished. Last response attached.');
            }),
          ),
        ),
      ),
    ),
  ).run();

  node('start [no task]', async (h) => {
    await h.prompt('main work', responds('working...'));
    await h.runStartTask();
    assert.strictEqual(h.getStatus(), undefined);
    h.assertBranchHistory(
      user('main work'),
      assistant('working...'),
    );
    h.assertNotifications('No pending task. Use push-task first.');
  }).run();

  node('discard [no task]', async (h) => {
    await h.prompt('main work', responds('working...'));
    await h.runDiscardTask();
    assert.strictEqual(h.getStatus(), undefined);
    h.assertBranchHistory(
      user('main work'),
      assistant('working...'),
    );
    h.assertNotifications('No pending task to discard.');
  }).run();

  node('finish [no task]', async (h) => {
    await h.prompt('main work', responds('working...'));
    await h.runFinishTask();
    assert.strictEqual(h.getStatus(), undefined);
    h.assertBranchHistory(
      user('main work'),
      assistant('working...'),
    );
    h.assertNotifications('Not inside task, nothing to finish.');
  }).run();

  node('abort [no task]', async (h) => {
    await h.prompt('main work', responds('working...'));
    await h.runAbortTask();
    assert.strictEqual(h.getStatus(), undefined);
    h.assertBranchHistory(
      user('main work'),
      assistant('working...'),
    );
    h.assertNotifications('Not inside task, nothing to abort.');
  }).run();
});
