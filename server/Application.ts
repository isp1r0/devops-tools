import * as connect from 'connect';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';
import { compile } from 'handlebars';
import { readdir, readFile } from 'fs-extra';
import { exists } from '../ts-scripts/utils';
import { Builder, IHash } from '../ts-scripts/build-wave-gui';
import { getCommitsList } from '../ts-scripts/github-api';
import { StaticServer } from './StaticServer';


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
    protected cache: IHash<ICacheItem>;
    private builder: Builder;
    private canRebuild: boolean;


    constructor(options: IOptions) {
        this.cache = Object.create(null);
        this.options = options;
        if (this.options.interval == null) {
            this.options.interval = 1000 * 60 * 10;
        }
        this.builder = new Builder({ outDir: this.options.builds });
        this.canRebuild = true;
        this.addInterval();
        this.runServer();
    }

    protected getBranchList(): Promise<Array<string>> {
        return readdir(this.options.builds);
    }

    protected getCommitList(branch: string): Promise<Array<{ sha: string; message: string }>> {
        return readdir(join(this.options.builds, branch))
            .then(getCommitsList)
    }

    protected getBuildsList(params: { name: string; commit: string }): Promise<Array<{ url: string; text: string; status: boolean }>> {
        const types = ['dev', 'normal', 'min'];
        const connects = ['mainnet', 'testnet'];
        const { name, commit } = params;
        const promises = [];

        connects.forEach((connection) => {
            types.forEach((type) => {
                const data = {
                    url: `http://${name}.${commit}.${connection}.${type}.localhost:${this.options.port}`,
                    text: `Branch: "${name}"` + '\n' + `commit: ${commit}` + '\n' + `${connection} ${type}`
                };
                const hostData = {
                    branch: params.name,
                    commit: params.commit,
                    connection,
                    type
                };
                const path = this.getBuildPath(hostData);
                promises.push(this.checkHost(hostData).then((status) => {
                    this.setCache(path, 'valid', status);
                    return { ...data, status };
                }));
            });
        });

        return Promise.all(promises);
    }

    protected abstract getRouter(): IHash<(data: IHash<string>) => Promise<string>>;

    private runServer(): void {
        const app = connect();

        app.use((req: IncomingMessage, res: ServerResponse, next: Function) => {
            const parsedHost = Application.parseHost(req.headers.host as string);
            if (parsedHost) {
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
            } else {
                const handler = this.getUrlHandler(req.url);
                if (handler) {
                    handler().then((text) => {
                        res.end(text);
                    });
                } else {
                    next();
                }
            }
        });

        createServer(app).listen(this.options.port);
    }

    private addInterval(): void {
        if (this.options.interval) {

            const runHandler = () => {
                this.builder.createBuilds(this.getLog()).then(() => {
                    setTimeout(runHandler, this.options.interval);
                });
            };

            setTimeout(runHandler, this.options.interval);
        }
    }

    private getLog(): (branch: string, commit: string) => (...args: Array<any>) => void {
        return (branch: string, commit: string) => {
            return (...args: Array<string>) => {
                console.log.apply(console, args);
            }
        };
    }

    private getStaticServer(parsedHost: IProjectOptions): any {
        const path = this.getBuildPath(parsedHost);
        if (!this.cache[path]) {
            this.cache[path] = Object.create(null);
        }
        if (!this.cache[path].serve) {
            this.cache[path].serve = new StaticServer(this.getRoots(parsedHost));
        }
        return this.cache[path].serve;
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

    private getCache(path: string): Partial<ICacheItem> {
        if (!this.cache[path]) {
            this.cache[path] = Object.create(null);
        }
        return this.cache[path];
    }

    private setCache<K extends keyof ICacheItem, V extends ICacheItem[K]>(path: string, key: K, value: V): void {
        const cache = this.getCache(path);
        cache[key] = value;
    }

    protected static getCompiledText(dataPromise: Promise<any>, templatePath: string): Promise<string> {
        return Promise.all([dataPromise, Application.getTemplate(templatePath)]).then((data) => {
            const [params, template] = data;
            return template(params);
        })
    }

    protected static getCompiledLinks(dataPromise: Promise<Array<ILinkItem>>): Promise<string> {
        return Application.getCompiledText(dataPromise.then((data) => {
            return { linkList: data };
        }), PATHS.linkList);
    }

    protected static getCompiledIndex(dataPromise: Promise<string>): Promise<string> {
        return Application.getCompiledText(dataPromise.then((content) => ({content})), PATHS.index);
    }

    private static getTemplate(templatePath: string): Promise<(data: any) => string> {
        return readFile(join(__dirname, templatePath), { encoding: 'utf8' }).then((fileText: string) => {
            return compile(fileText);
        });
    }

    private static parseHost(host: string): IProjectOptions {
        const parts = host.split('.');
        parts.pop();

        const result = {
            branch: parts[HOST_PARTS.Branch],
            commit: parts[HOST_PARTS.Commit],
            connection: parts[HOST_PARTS.Connect],
            type: parts[HOST_PARTS.BuildType]
        };

        if (Object.keys(result).map((name) => result[name]).every(Boolean)) {
            return result;
        } else {
            return null;
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

export interface IOptions {
    builds: string;
    port: string;
    interval?: number;
}

export interface ICacheItem {
    valid: boolean;
    logs: string;
    path: string;
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
