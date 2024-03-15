// Copyright 2023 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import createDebug from 'debug';
import Long from 'long';

import * as durations from '../../util/durations';
import type { App } from '../playwright';
import { Bootstrap } from '../bootstrap';

export const debug = createDebug('mock:test:backups');

describe('backups', function (this: Mocha.Suite) {
  this.timeout(100 * durations.MINUTE);

  let bootstrap: Bootstrap;
  let app: App;

  beforeEach(async () => {
    bootstrap = new Bootstrap();
    await bootstrap.init();
    app = await bootstrap.link();
  });

  afterEach(async function (this: Mocha.Context) {
    if (!bootstrap) {
      return;
    }

    await bootstrap.maybeSaveLogs(this.currentTest, app);
    await app.close();
    await bootstrap.teardown();
  });

  it('exports and imports backup', async function () {
    const { contacts, phone, desktop, server } = bootstrap;
    const [friend] = contacts;

    for (let i = 0; i < 5; i += 1) {
      const theirTimestamp = bootstrap.getTimestamp();

      // eslint-disable-next-line no-await-in-loop
      await friend.sendText(desktop, `msg ${i}`, {
        timestamp: theirTimestamp,
      });

      const ourTimestamp = bootstrap.getTimestamp();

      // eslint-disable-next-line no-await-in-loop
      await server.send(
        desktop,
        // eslint-disable-next-line no-await-in-loop
        await phone.encryptSyncSent(desktop, `respond ${i}`, {
          timestamp: ourTimestamp,
          destinationServiceId: friend.device.aci,
        })
      );

      const reactionTimestamp = bootstrap.getTimestamp();

      // eslint-disable-next-line no-await-in-loop
      await friend.sendRaw(
        desktop,
        {
          dataMessage: {
            timestamp: Long.fromNumber(reactionTimestamp),
            reaction: {
              emoji: '👍',
              targetAuthorAci: desktop.aci,
              targetTimestamp: Long.fromNumber(ourTimestamp),
            },
          },
        },
        {
          timestamp: reactionTimestamp,
        }
      );
    }

    const comparator = await bootstrap.createScreenshotComparator(
      app,
      async (window, snapshot) => {
        const leftPane = window.locator('#LeftPane');
        const contactElem = leftPane.locator(
          `[data-testid="${friend.toContact().aci}"] >> "respond 4"`
        );

        debug('Waiting for messages to come through');
        await contactElem.waitFor();

        await snapshot('main screen');

        debug('Going into the conversation');
        await contactElem.click();
        await window
          .locator('.ConversationView .module-message >> "respond 4"')
          .waitFor();

        await snapshot('conversation');
      },
      this.test
    );

    const backupPath = bootstrap.getBackupPath('backup.bin');
    await app.exportBackupToDisk(backupPath);
    await app.close();

    // Restart
    await bootstrap.unlink();
    app = await bootstrap.link({
      ciBackupPath: backupPath,
    });

    await comparator(app);
  });
});
