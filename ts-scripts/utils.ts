import { exists as fsExits } from 'fs-extra';
import * as AdmZip from 'adm-zip';
import { spawn } from 'child_process';


export function run(command: string, args: Array<string>, log: Function): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const process = spawn(command, args);

            process.stdout.on('data', (data) => log(String(data)));
            process.stderr.on('data', (data) => log(String(data)));

            process.on('close', (code: number) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject();
                }
            });
        } catch (e) {
            reject();
        }
    });
}

export function parseArguments<T>(): T {
    const result = Object.create(null);
    process.argv.forEach((argument) => {
        if (argument.includes('=')) {
            const index = argument.indexOf('=');
            const name = argument.substr(0, index);
            const value = argument.substr(index + 1);
            result[name] = value;
        } else {
            result[argument] = true;
        }
    });
    return result;
}

export function exists(path: string): Promise<boolean> {
    return new Promise((resolve) => {
        fsExits(path, (result) => {
            resolve(result);
        });
    });
}

export function processList<T>(list: Array<T>, processor: (item: T) => Promise<any>): Promise<any> {

    list.reverse();

    function iterate(): Promise<any> {
        if (list.length) {
            return processor(list.pop()).then(iterate);
        } else {
            return Promise.resolve();
        }
    }

    return new Promise((resolve, reject) => {
        iterate().then(resolve, reject);
    });
}

export function extractZIP(buffer: Buffer, out: string, log: Function): Promise<any> {
    log(out);
    const zip = new AdmZip(buffer);
    zip.extractAllTo(out);
    return Promise.resolve();
}

export function always<T>(promise: PromiseLike<T>, handler: (data: T) => any): PromiseLike<T> {
    promise.then(handler, handler);
    return promise;
}

export function resolve(promise: Promise<any>): Promise<boolean> {
    return new Promise((resolve) => {
        promise.then(() => resolve(true), () => resolve(false));
    });
}
