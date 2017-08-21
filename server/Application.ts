import * as connect from 'connect';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import { compile } from 'handlebars';
import { mkdirp, readdir, readFile } from 'fs-extra';
import { exists } from '../ts-scripts/utils';
import { Builder, IHash } from '../ts-scripts/build-wave-gui';
import { GithubAPI } from '../ts-scripts/github-api';
import { StaticServer } from './StaticServer';
import { cached } from './decorators/cached';
import { yellow } from 'colors/safe';


export const PATHS = {
    'linkList': 'front/linkList.hbs',
    'index': 'front/index.hbs'
};

const enum HOST_PARTS {
    Branch,
    Commit,
    Connect,
    BuildType
}


export abstract class Application {

    protected readonly options: IOptions;
    protected  hostName: string;
    protected cacheBuild: IHash<ICacheItem>;
    protected cache: any;
    protected builder: Builder;
    private canRebuild: boolean;


    constructor(options: IOptions) {
        this.cacheBuild = Object.create(null);
        this.cache = Object.create(null);
        this.options = options;
        if (this.options.interval == null) {
            this.options.interval = 5;
        }
        this.builder = new Builder({ outDir: this.options.builds });
        this.canRebuild = true;
        this.addInterval();
        this.runServer();
    }

    protected getLastCommit(branch: string): Promise<string> {
        return GithubAPI.getBranchList().then((branches) => {
            let commit = null;
            branches.some((item) => {
                if (item.name === branch) {
                    commit = item.commit.sha;
                }
                return !!commit;
            });

            return commit;
        });
    }

    protected getBranchList(): Promise<Array<string>> {
        return GithubAPI.getBranchList().then((list) => {
            return list.map((item) => item.name);
        });
    }

    protected getCommitList(branch: string): Promise<Array<{ sha: string; message: string }>> {
        return readdir(join(this.options.builds, branch))
            .then(GithubAPI.getCommitsList)
    }

    protected getBuildsList(params: { name: string; commit: string }, latest?: boolean): Promise<Array<{ url: string; text: string; status: boolean }>> {
        const types = ['dev', 'normal', 'min'];
        const connects = ['mainnet', 'testnet'];
        const name = params.name;
        const commit = latest ? 'latest' : params.commit;
        const promises = [];

        connects.forEach((connection) => {
            types.forEach((type) => {
                const data = {
                    url: `http://${name}.${commit}.${connection}.${type}.${this.hostName}:${this.options.port}`,
                    text: `Branch: "${name}"` + '\n' + `commit: ${commit}` + '\n' + `${connection} ${type}`
                };
                const hostData = {
                    branch: params.name,
                    commit: params.commit,
                    connection,
                    type
                };
                promises.push(this.checkHost(hostData).then((status) => {
                    return { ...data, status };
                }, () => {
                    console.warn(yellow('Check host error!'));
                    return { ...data, status: false }
                }));
            });
        });

        return Promise.all(promises);
    }

    protected getCommitStatus(branch: string, commit: string): Promise<TStatus> {
        return this.getBuildsList({ name: branch, commit }).then((list) => {
            let successCount = 0;
            list.forEach((item) => {
                if (item.status) {
                    successCount++;
                }
            });
            if (successCount === list.length) {
                return 'success';
            } else if (successCount) {
                return 'partial'
            } else {
                return 'fail';
            }
        }).catch(() => {
            return 'fail' as 'fail';
        });
    }

    protected getBranchStatus(branch: string): Promise<TStatus> {
        return this.getCommitList(branch).then((list) => {
            const promises = list.map((item) => {
                return this.getCommitStatus(branch, item.sha).catch(() => {
                    return false;
                });
            });
            return Promise.all(promises);
        }).then((statuses) => {
            let partial = 0;
            let success = 0;
            statuses.forEach((status) => {
                if (status === 'success') {
                    success++;
                } else if (status === 'partial') {
                    partial++;
                }
            });
            if (success === statuses.length) {
                return 'success';
            } else if (partial) {
                return 'partial';
            } else {
                return 'fail';
            }
        }).catch(() => {
            return 'fail' as 'fail';
        });
    }

    protected abstract getRouter(): IHash<(data: IHash<string>) => Promise<string>>;

    protected getLog(): (branch: string, commit: string) => (...args: Array<any>) => void {
        return (branch: string, commit: string) => {
            return (...args: Array<string>) => {
                console.log.apply(console, args);
            }
        };
    }

    private runServer(): void {
        const app = connect();

        app.use((req: IncomingMessage, res: ServerResponse, next: Function) => {

            if (!this.hostName) {
                let host = req.headers.host as string;
                host = host.replace(`:${this.options.port}`, '');
                this.hostName = host.split('.').pop();
            }

            this.parseHost(req.headers.host as string).then((parsedHost) => {
                this.checkHost(parsedHost).then((exist: boolean) => {
                    if (exist) {
                        if (Application.isPage(req.url)) {
                            readFile(this.getBuildPath(parsedHost) + '/index.html')
                                .then((text) => {
                                    res.end(text);
                                });
                        } else {
                            req.addListener('end', () => {
                                this.getStaticServer(parsedHost).serve(req, res);
                            }).resume();
                        }
                    } else {
                        res.writeHead(302, {
                            Location: Application.getDefaultUrl(req.headers.host as string)
                        });
                        res.end();
                    }
                });
            }, () => {
                const handler = this.getUrlHandler(req.url);
                if (handler) {
                    handler().then((text) => {
                        res.end(text);
                    }, (e) => {
                        res.writeHead(404);
                        res.end('Error!' + e.message);
                        console.log(e);
                    });
                } else {
                    next();
                }
            });
        });

        createServer(app).listen(this.options.port);
    }

    private addInterval(): void {
        const interval = this.options.interval * 1000 * 60;
        const run = () => {
            if (this.options.interval) {

                const runHandler = () => {
                    this.builder.createBuilds(this.getLog()).then(() => {
                        setTimeout(runHandler, interval);
                    });
                };

                setTimeout(runHandler, interval);
            }
        };

        readdir(this.options.builds).then((list) => {
            if (!list.length) {
                this.builder.createBuilds(this.getLog()).then(run);
            } else {
                run();
            }
        }).catch(() => {
            mkdirp(this.options.builds).then(() => {
                this.builder.createBuilds(this.getLog()).then(run);
            });
        });
    }

    private getStaticServer(parsedHost: IProjectOptions): any {
        const path = this.getBuildPath(parsedHost);
        if (!this.cacheBuild[path]) {
            this.cacheBuild[path] = Object.create(null);
        }
        if (!this.cacheBuild[path].serve) {
            this.cacheBuild[path].serve = new StaticServer(this.getRoots(parsedHost));
        }
        return this.cacheBuild[path].serve;
    }

    private getUrlHandler(url: string): () => Promise<string> {
        const route = this.getRouter();
        let handler = null;
        Object.keys(route).some((item: string) => {
            const partsRoute = item.split('/');
            const partsUrl = url.split('/');
            const params = Object.create(null);
            const isEqual = (part: string, i) => {
                if (part[0] === ':') {
                    params[part.substr(1)] = partsUrl[i];
                    return true;

                }
                return part === partsUrl[i];
            };

            if (partsRoute.length === partsUrl.length && partsRoute.every(isEqual)) {
                handler = function () {
                    return route[item](params);
                }
            }

            return !!handler;
        });

        return handler;
    }

    private checkHost(hostParts: IProjectOptions): Promise<boolean> {
        return exists(this.getBuildPath(hostParts));
    }

    private getBuildPath(params: IProjectOptions): string {
        const { branch, commit, connection, type } = params;
        const base = this.options.builds;
        return `${base}/${branch}/${commit}/WavesGUI-${commit}/dist/build/${connection}/${type}`;
    }

    private getRoots(params: IProjectOptions): Array<string> {
        const { branch, commit, connection, type } = params;
        const base = this.options.builds;
        return [
            `${base}/${branch}/${commit}/WavesGUI-${commit}/dist/build/${connection}/${type}`,
            `${base}/${branch}/${commit}/WavesGUI-${commit}`,
        ]
    }

    protected static getCompiledText(dataPromise: Promise<any>, templatePath: string): Promise<string> {
        return Promise.all([dataPromise, Application.getTemplate(templatePath)]).then((data) => {
            const [params, template] = data;
            return template(params);
        })
    }

    protected static getCompiledLinks(dataPromise: Promise<Array<ILinkItem>>): Promise<string> {
        return Application.getCompiledText(dataPromise, PATHS.linkList);
    }

    protected static getCompiledIndex(dataPromise: Promise<string>): Promise<string> {
        return Application.getCompiledText(dataPromise, PATHS.index);
    }

    @cached
    private static getTemplate(templatePath: string): Promise<(data: any) => string> {
        return readFile(join(__dirname, templatePath), { encoding: 'utf8' }).then((fileText: string) => {
            return compile(fileText);
        });
    }

    private parseHost(host: string): Promise<IProjectOptions> {
        const parts = host.split('.');
        parts.pop();

        const result = {
            branch: parts[HOST_PARTS.Branch],
            commit: parts[HOST_PARTS.Commit],
            connection: parts[HOST_PARTS.Connect],
            type: parts[HOST_PARTS.BuildType]
        };

        if (Object.keys(result).map((name) => result[name]).every(Boolean)) {
            if (result.commit === 'latest') {
                return this.getLastCommit(result.branch).then((commit) => {
                    return { ...result, commit };
                });
            } else {
                return Promise.resolve(result);
            }
        } else {
            return Promise.reject(null);
        }
    }

    private static getDefaultUrl(host: string): string {
        return `http://${host.split('.').pop()}`;
    }

    private static isPage(url: string): boolean {
        const staticPathPartial = [
            'img', 'css', 'fonts', 'js', 'bower_components', 'node_modules'
        ];
        return !staticPathPartial.some((path) => {
            return url.includes(`/${path}/`);
        });
    }

}

export type TStatus = 'fail' | 'success' | 'partial';

export interface IOptions {
    builds: string;
    port: string;
    interval?: number;
}

export interface ICacheItem {
    serve: StaticServer;
}

export interface ILinkItem {
    url: string;
    text: string;
    status?: string;
}

interface IProjectOptions {
    branch: string;
    commit: string;
    connection: string;
    type: string;
}
