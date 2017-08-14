import { getBranchList, getCommitArchive, IBranch } from './github-api';
import { exists, extractZIP, parseArguments, processList, resolve, run } from './utils';
import { join } from 'path';
import { readJSON, remove, writeJSON } from 'fs-extra';
import { execSync } from 'child_process';


export class Builder {

    protected readonly options: IOptions;
    protected readonly metaPath: string;
    protected meta: TMeta;


    constructor(options: IOptions) {
        this.options = Object.create(null);
        this.options.outDir = options.outDir;
        this.options.maxBuilds = options.maxBuilds || 50;
        this.metaPath = join(__dirname, 'meta.json');

        if (!this.options.outDir) {
            console.error('No out path!');
            process.exit(1);
        }
    }

    public createBuilds(getLog: IGetLog): Promise<void> {
        console.log('start rebuild');
        return this.getListBundles()
            .then((list) => this.cleanBuilds(list))
            .then(getBranchList)
            .then((list) => {
                return this.removeOldBranches(list);
            })
            .then((list) => {
                return processList(list, (branch: IBranch) => {
                    return this.isHasBuild(branch)
                        .then((hasBuild: boolean) => {
                            if (hasBuild) {
                                return Promise.resolve(Object.create(null));
                            } else {
                                return this.build(branch, getLog);
                            }
                        });
                });
            })
            .catch((e) => {
                return e;
            })
            .then((error) => {
                return writeJSON(this.metaPath, this.meta).then(() => {
                    if (error) {
                        console.error(error);
                        process.exit(1);
                    }
                });
            });
    }

    protected removeOldBranches(list: Array<Readonly<IBranch>>): Promise<Array<Readonly<IBranch>>> {
        const toRemove = Object.keys(this.meta).filter((name) => {
            return !list.some((branchData) => {
                return branchData.name === name;
            });
        });

        return Promise.all(toRemove.map((name) => {
            console.log(`remove build ${name}`);
            return remove(join(this.options.outDir, name));
        })).then(() => list);
    }

    protected getListBundles(): Promise<TMeta> {
        return exists(this.metaPath).then((state) => {
            if (state) {
                return readJSON(this.metaPath);
            } else {
                return Promise.resolve(Object.create(null));
            }
        });
    }

    protected cleanBuilds(hash: TMeta): Promise<void> {
        console.log('clean builds');
        this.meta = hash;
        const list = Object.keys(hash);
        if (!list.length) {
            console.log('remove all');
            return remove(this.options.outDir);
        } else {
            return Promise.all(list.map((branch) => {
                const commits = hash[branch];
                const toRemove = commits.slice(this.options.maxBuilds - 1);
                console.log(`builds to remove: ${toRemove.join(', ')}`);
                if (toRemove.length) {
                    const promises = toRemove.map((commit) => remove(join(this.options.outDir, branch, commit.sha)));
                    return Promise.all(promises).then(() => null);
                } else {
                    return Promise.resolve();
                }
            })).then(() => null);
        }
    }

    protected isHasBuild(branch: IBranch): Promise<boolean> {
        console.log(`check is need load archive for branch ${branch.name} ${join(this.options.outDir, branch.name, branch.commit.sha)}`);
        console.log(String(execSync('pwd')));
        return exists(join(this.options.outDir, branch.name, branch.commit.sha));
    }

    protected build(branch: IBranch, getLog: IGetLog): Promise<void> {
        console.log(`run create build for branch ${branch.name}`);
        const path = join(this.options.outDir, branch.name, branch.commit.sha);
        const packageJsonPath = join(path, `WavesGUI-${branch.commit.sha}`);
        const log = getLog(branch.name, branch.commit.sha);

        return getCommitArchive(branch.commit.sha)
            .then((archive: Buffer) => {
                console.log('extract archive');
                return extractZIP(archive, path, log);
            })
            .then(() => {
                console.log('run npm install');
                return resolve(run('npm', ['--prefix', packageJsonPath, 'install'], log))
            })
            .then(() => {
                let status = true;
                try {
                    execSync(`${packageJsonPath}/node_modules/.bin/gulp ----gulpfile ${packageJsonPath} all`);
                } catch (e) {
                    status = false;
                }
                return status;
            })
            .then((status) => {
                if (!this.meta[branch.name]) {
                    this.meta[branch.name] = [{ sha: branch.commit.sha, success: status }];
                } else {
                    this.meta[branch.name].push({ sha: branch.commit.sha, success: status });
                }
            });
    }
}

const params = parseArguments() as IOptions;
if (params.outDir) {
    new Builder(params);
}

export interface IOptions {
    outDir: string;
    maxBuilds?: number;
}

export interface IHash<T> {
    [key: string]: T;
}

export type TMeta = IHash<Array<{
    sha: string;
    success: boolean;
}>>;

export interface IGetLog {
    (branch: string, commit: string): (...args: Array<any>) => void;
}
