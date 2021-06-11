import { once } from 'events';
import * as fs from 'fs';
import * as path from 'path';

import {
  _electron as electron,
  ConsoleMessage,
  Dialog,
  ElectronApplication,
  Page,
} from 'playwright';

import { NativefierOptions } from './options/model';
import { getTempDir } from './helpers/helpers';

const INJECT_DIR = path.join(__dirname, '..', 'app', 'inject');

const log = console;

describe('Application launch', () => {
  jest.setTimeout(10000);

  let app: ElectronApplication;
  let appClosed = true;

  const appMainJSPath = path.join(__dirname, '..', 'app', 'lib', 'main.js');
  const DEFAULT_CONFIG: NativefierOptions = {
    targetUrl: 'https://npmjs.com',
  };

  const logFileDir = getTempDir('playwright');

  const metaOrAlt = process.platform === 'darwin' ? 'Meta' : 'Alt';
  const metaOrCtrl = process.platform === 'darwin' ? 'Meta' : 'Control';

  // Create a reporter that only displays the log on failure
  const logReporter = {
    specDone: function (result: { status: string }): void {
      if (result.status === 'failed') {
        showLogs(logFileDir);
      }
    },
  };

  // @ts-expect-error should be here at runtime
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  jasmine.getEnv().addReporter(logReporter);

  const spawnApp = async (
    playwrightConfig: NativefierOptions = { ...DEFAULT_CONFIG },
  ): Promise<Page> => {
    app = await electron.launch({
      args: [appMainJSPath],
      env: {
        LOG_FILE_DIR: logFileDir,
        PLAYWRIGHT_TEST: '1',
        PLAYWRIGHT_CONFIG: JSON.stringify(playwrightConfig),
        USE_LOG_FILE: '1',
        VERBOSE: '1',
      },
    });
    app.on('close', () => (appClosed = true));
    appClosed = false;
    const window = await app.firstWindow();
    window.addListener('console', (consoleMessage: ConsoleMessage) => {
      const consoleMethods: Record<string, (...args: unknown[]) => unknown> = {
        debug: log.debug.bind(console),
        error: log.error.bind(console),
        info: log.info.bind(console),
        log: log.log.bind(console),
        trace: log.trace.bind(console),
        warn: log.warn.bind(console),
      };
      Promise.all(consoleMessage.args().map((x) => x.jsonValue()))
        .then((args) => {
          if (consoleMessage.type() in consoleMethods) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            consoleMethods[consoleMessage.type()]('window.console', args);
          } else {
            log.log('window.console', args);
          }
        })
        .catch((err: unknown) => log.error(err));
    });
    return window;
  };

  beforeEach(() => {
    nukeInjects();
    nukeLogs(logFileDir);
  });

  afterEach(async () => {
    if (app && !appClosed) {
      await app.close();
    }
  });

  test('shows an initial window', async () => {
    const mainWindow = await spawnApp();
    await mainWindow.waitForLoadState('domcontentloaded');
    expect(app.windows()).toHaveLength(1);
    expect(await mainWindow.title()).toBe('npm');
  });

  test('can inject some CSS', async () => {
    const fuschia = 'rgb(255, 0, 255)';
    createInject(
      'inject.css',
      `* { background-color: ${fuschia} !important; }`,
    );
    const mainWindow = await spawnApp();
    await mainWindow.waitForLoadState('domcontentloaded');
    expect(await mainWindow.isVisible('header')).toBe(true);
    const headerStyle = await mainWindow.$eval('header', (el) =>
      window.getComputedStyle(el),
    );
    expect(headerStyle.backgroundColor).toBe(fuschia);
  });

  test('can inject some JS', async () => {
    const alertMsg = 'hello world from inject';
    createInject(
      'inject.js',
      `setTimeout(() => {alert("${alertMsg}"); }, 2000);`, // Buy ourselves 2 seconds to get the dialog handler setup
    );
    const mainWindow = await spawnApp();
    const [dialogPromise] = (await once(
      mainWindow,
      'dialog',
    )) as unknown as Promise<Dialog>[];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const dialog: Dialog = await dialogPromise;
    await dialog.dismiss();
    expect(dialog.message()).toBe(alertMsg);
  });

  test('can open internal links', async () => {
    const mainWindow = await spawnApp();
    await mainWindow.waitForLoadState('domcontentloaded');
    await mainWindow.click('#nav-products-link');
    await mainWindow.waitForLoadState('domcontentloaded');
    expect(app.windows()).toHaveLength(1);
  });

  test('tries to open external links', async () => {
    const mainWindow = await spawnApp();
    await mainWindow.waitForLoadState('domcontentloaded');
    const [openExternalUrl] = await Promise.all([
      app.evaluate(async ({ shell }) => {
        return new Promise((resolve) => {
          shell.openExternal = (url: string): Promise<void> => {
            resolve(url);
            return Promise.resolve();
          };
        });
      }),
      mainWindow.click('#footer > div:nth-child(2) > ul > li:nth-child(2) > a'),
    ]);
    expect(openExternalUrl).not.toBe(DEFAULT_CONFIG.targetUrl);
  });

  // test('keyboard shortcuts: back and forward', async () => {
  //   const mainWindow = await spawnApp();
  //   await mainWindow.waitForLoadState('domcontentloaded');

  //   // // Go to a new page
  //   // await Promise.all([
  //   //   mainWindow.click('#nav-products-link'),
  //   //   mainWindow.waitForNavigation({ waitUntil: 'domcontentloaded' }),
  //   // ]);

  //   // // Go back
  //   // const [, , [backFrame]] = await Promise.all([
  //   //   mainWindow.keyboard.press(`${metaOrAlt}+ArrowLeft`),
  //   //   mainWindow.waitForNavigation({ waitUntil: 'domcontentloaded' }),
  //   //   (await once(mainWindow, 'framenavigated')) as unknown as Promise<Frame[]>,
  //   //   new Promise((resolve) => setTimeout(resolve, 3000)),
  //   // ]);

  //   // expect(backFrame.url()).toBe(DEFAULT_CONFIG.targetUrl);

  //   // // Go forward
  //   // const [, , [forwardFrame]] = await Promise.all([
  //   //   mainWindow.keyboard.press(`${metaOrAlt}+ArrowRight`),
  //   //   mainWindow.waitForNavigation({ waitUntil: 'domcontentloaded' }),
  //   //   (await once(mainWindow, 'framenavigated')) as unknown as Promise<Frame[]>,
  //   //   new Promise((resolve) => setTimeout(resolve, 3000)),
  //   // ]);

  //   // expect(forwardFrame.url()).not.toBe(DEFAULT_CONFIG.targetUrl);

  //   await Promise.all([
  //     mainWindow.click('#nav-products-link'),
  //     mainWindow.waitForNavigation({ waitUntil: 'domcontentloaded' }),
  //   ]);

  //   // Go back
  //   console.log(`${metaOrAlt}+ArrowLeft`);
  //   await mainWindow.keyboard.press(`${metaOrAlt}+ArrowLeft`);
  //   await mainWindow.waitForLoadState('domcontentloaded');
  //   await new Promise((resolve) => setTimeout(resolve, 3000));

  //   const backUrl = await mainWindow.evaluate(() => window.location.href);

  //   expect(backUrl).toBe(DEFAULT_CONFIG.targetUrl);

  //   // Go forward
  //   console.log(`${metaOrAlt}+ArrowRight`);
  //   await mainWindow.keyboard.press(`${metaOrAlt}+ArrowRight`);
  //   await mainWindow.waitForLoadState('domcontentloaded');
  //   await new Promise((resolve) => setTimeout(resolve, 3000));

  //   const forwardUrl = await mainWindow.evaluate(() => window.location.href);

  //   expect(forwardUrl).not.toBe(DEFAULT_CONFIG.targetUrl);
  // });
});

function createInject(filename: string, contents: string): void {
  fs.writeFileSync(path.join(INJECT_DIR, filename), contents);
}

function nukeInjects(): void {
  const injected = fs
    .readdirSync(INJECT_DIR)
    .filter((x) => x !== '_placeholder');
  injected.forEach((x) => fs.unlinkSync(path.join(INJECT_DIR, x)));
}

function nukeLogs(logFileDir: string): void {
  const logs = fs.readdirSync(logFileDir).filter((x) => x.endsWith('.log'));
  logs.forEach((x) => fs.unlinkSync(path.join(logFileDir, x)));
}

function showLogs(logFileDir: string): void {
  const logs = fs.readdirSync(logFileDir).filter((x) => x.endsWith('.log'));
  for (const logFile of logs) {
    log.log(fs.readFileSync(path.join(logFileDir, logFile)).toString());
  }
}
