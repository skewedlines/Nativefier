import * as fs from 'fs';
import * as path from 'path';

import * as electronGet from '@electron/get';
import electronPackager from 'electron-packager';
import * as log from 'loglevel';

import { convertIconIfNecessary } from './buildIcon';
import {
  copyFileOrDir,
  getTempDir,
  hasWine,
  isWindows,
  isWindowsAdmin,
} from '../helpers/helpers';
import { useOldAppOptions, findUpgradeApp } from '../helpers/upgrade/upgrade';
import { AppOptions, RawOptions } from '../../shared/src/options/model';
import { getOptions } from '../options/optionsMain';
import { prepareElectronApp } from './prepareElectronApp';
import ncp = require('ncp');
import { promisify } from 'util';

const OPTIONS_REQUIRING_WINDOWS_FOR_WINDOWS_BUILD = [
  'icon',
  'appCopyright',
  'appVersion',
  'buildVersion',
  'versionString',
  'win32metadata',
];

/**
 * For Windows & Linux, we have to copy over the icon to the resources/app
 * folder, which the BrowserWindow is hard-coded to read the icon from
 */
async function copyIconsIfNecessary(
  options: AppOptions,
  appPath: string,
): Promise<void> {
  log.debug('Copying icons if necessary');
  if (!options.packager.icon) {
    log.debug('No icon specified in options; aborting');
    return;
  }

  if (
    options.packager.platform === 'darwin' ||
    options.packager.platform === 'mas'
  ) {
    if (options.nativefier.tray !== 'false') {
      //tray icon needs to be .png
      log.debug('Copying icon for tray application');
      const trayIconFileName = `tray-icon.png`;
      const destIconPath = path.join(appPath, 'icon.png');
      await copyFileOrDir(
        `${path.dirname(options.packager.icon)}/${trayIconFileName}`,
        destIconPath,
      );
    } else {
      log.debug('No copying necessary on macOS; aborting');
    }
    return;
  }

  // windows & linux: put the icon file into the app
  const destFileName = `icon${path.extname(options.packager.icon)}`;
  const destIconPath = path.join(appPath, destFileName);

  log.debug(`Copying icon ${options.packager.icon} to`, destIconPath);
  await copyFileOrDir(options.packager.icon, destIconPath);
}

/**
 * Checks the app path array to determine if packaging completed successfully
 */
function getAppPath(appPath: string | string[]): string | undefined {
  if (!Array.isArray(appPath)) {
    return appPath;
  }

  if (appPath.length === 0) {
    return undefined; // directory already exists and `--overwrite` not set
  }

  if (appPath.length > 1) {
    log.warn(
      'Warning: This should not be happening, packaged app path contains more than one element:',
      appPath,
    );
  }

  return appPath[0];
}

function isUpgrade(rawOptions: RawOptions): boolean {
  if (
    rawOptions.upgrade !== undefined &&
    typeof rawOptions.upgrade === 'string' &&
    rawOptions.upgrade !== ''
  ) {
    rawOptions.upgradeFrom = rawOptions.upgrade;
    rawOptions.upgrade = true;
    return true;
  }
  return false;
}

function trimUnprocessableOptions(options: AppOptions): void {
  if (options.packager.platform === 'win32' && !isWindows() && !hasWine()) {
    const optionsPresent = Object.entries(options)
      .filter(
        ([key, value]) =>
          OPTIONS_REQUIRING_WINDOWS_FOR_WINDOWS_BUILD.includes(key) && !!value,
      )
      .map(([key]) => key);
    if (optionsPresent.length === 0) {
      return;
    }
    log.warn(
      `*Not* setting [${optionsPresent.join(', ')}], as couldn't find Wine.`,
      'Wine is required when packaging a Windows app under on non-Windows platforms.',
      'Also, note that Windows apps built under non-Windows platforms without Wine *will lack* certain',
      'features, like a correct icon and process name. Do yourself a favor and install Wine, please.',
    );
    for (const keyToUnset of optionsPresent) {
      (options as unknown as Record<string, undefined>)[keyToUnset] = undefined;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export async function buildNativefierApp(
  rawOptions: RawOptions,
): Promise<string | undefined> {
  log.info('\nProcessing options...');

  const tmpUpgradePath = getTempDir('upgrade', 0o755);

  if (isUpgrade(rawOptions)) {
    log.debug('Attempting to upgrade from', rawOptions.upgradeFrom);
    const oldApp = findUpgradeApp(rawOptions.upgradeFrom as string);
    if (oldApp === null) {
      throw new Error(
        `Could not find an old Nativfier app in "${
          rawOptions.upgradeFrom as string
        }"`,
      );
    }
    rawOptions = useOldAppOptions(rawOptions, oldApp);
    // if (!rawOptions.out && rawOptions.overwrite) {
    //   rawOptions.out = tmpUpgradePath;
    if (rawOptions.out === undefined && rawOptions.overwrite) {
      rawOptions.out = path.dirname(rawOptions.upgradeFrom as string);
    }
  }
  log.debug('rawOptions', rawOptions);

  const options = await getOptions(rawOptions);
  log.debug('options', options);

  if (options.packager.platform === 'darwin' && isWindows()) {
    // electron-packager has to extract the desired electron package for the target platform.
    // For a target platform of Mac, this zip file contains symlinks. And on Windows, extracting
    // files that are symlinks need Admin permissions. So we'll check if the user is an admin, and
    // fail early if not.
    // For reference
    // https://github.com/electron/electron-packager/issues/933
    // https://github.com/electron/electron-packager/issues/1194
    // https://github.com/electron/electron/issues/11094
    if (!isWindowsAdmin()) {
      throw new Error(
        'Building an app with a target platform of Mac on a Windows machine requires admin priveleges to perform. Please rerun this command in an admin command prompt.',
      );
    }
  }

  log.info('\nPreparing Electron app...');
  const tmpPath = getTempDir('app', 0o755);
  await prepareElectronApp(options.packager.dir, tmpPath, options);

  log.info('\nConverting icons...');
  options.packager.dir = tmpPath; // const optionsWithTmpPath = { ...options, dir: tmpPath };
  convertIconIfNecessary(options);
  await copyIconsIfNecessary(options, tmpPath);

  log.info(
    "\nPackaging... This will take a few seconds, maybe minutes if the requested Electron isn't cached yet...",
  );
  trimUnprocessableOptions(options);
  electronGet.initializeProxy(); // https://github.com/electron/get#proxies
  const appPathArray = await electronPackager(options.packager);

  log.info('\nFinalizing build...');
  let appPath = getAppPath(appPathArray);

  if (!appPath) {
    throw new Error('App Path could not be determined.');
  }

  if (
    options.packager.upgrade &&
    options.packager.upgradeFrom &&
    options.packager.overwrite &&
    rawOptions.out ==
      path.resolve(path.join(options.packager.upgradeFrom, '..'))
  ) {
    let newPath = path.dirname(options.packager.upgradeFrom);
    const syncNcp = promisify(ncp);
    if (options.packager.platform === 'darwin') {
      await syncNcp(
        path.join(appPath, `${options.packager.name ?? ''}.app`),
        newPath,
        { clobber: options.packager.overwrite },
      );
      newPath = newPath.endsWith('.app')
        ? newPath
        : path.join(newPath, `${options.packager.name ?? ''}.app`);
    } else {
      const ncpPromises = fs.readdirSync(appPath).map(() =>
        syncNcp(
          // @ts-expect-error appPath won't be undefined, we checked
          path.join(appPath, `${options.packager.name ?? ''}`),
          newPath,
          { clobber: options.packager.overwrite },
        ),
      );
      await Promise.all(ncpPromises);
    }
    fs.rmdirSync(appPath, { recursive: true });
    appPath = newPath;
  }

  let osRunHelp = '';
  if (options.packager.platform === 'win32') {
    osRunHelp = `the contained .exe file.`;
  } else if (options.packager.platform === 'linux') {
    osRunHelp = `the contained executable file (prefixing with ./ if necessary)\nMenu/desktop shortcuts are up to you, because Nativefier cannot know where you're going to move the app. Search for "linux .desktop file" for help, or see https://wiki.archlinux.org/index.php/Desktop_entries`;
  } else if (options.packager.platform === 'darwin') {
    osRunHelp = `the app bundle.`;
  }
  log.info(
    `App built to ${appPath}, move to wherever it makes sense for you and run ${osRunHelp}`,
  );

  return appPath;
}
