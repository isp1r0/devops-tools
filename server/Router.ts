import { Application } from './Application';
import { parseArguments } from '../ts-scripts/utils';
import { IHash } from '../ts-scripts/build-wave-gui';
import { getBranchList } from '../ts-scripts/github-api';


export class Router extends Application {

    protected getRouter(): IHash<(data: IHash<string>) => Promise<string>> {
        return {
            '/': () => this.getIndexHTML(),
            '/index.html': () => this.getIndexHTML(),
            '/branch/:name': (params: { name: string }) => this.getBranchHTML(params),
            '/branch/:name/commit/:commit/reinstall': (params: { name: string, commit: string }) => this.reinstall(params),
            '/branch/:name/commit/:commit': (params: { name: string, commit: string }) => this.getBuildsHTML(params),
            '/branch/:name/latest': (params: { name: string }) => this.getLatestBuildHTML(params)
        }
    }

    private reinstall(params: {name: string, commit: string}): Promise<string> {
        return this.builder.install(params.name, params.commit, this.getLog()(params.name, params.commit)).then(() => {
            return 'ok!';
        }, () => 'fail');
    }

    private getIndexHTML(): Promise<string> {
        const branches = this.getBranchList()
            .then((names) => {
                return Promise.all(names.map((name) => this.getBranchStatus(name)))
                    .then((status) => {
                        return names.map((name, i) => {
                            return {
                                url: `/branch/${name}`,
                                text: name,
                                status: status[i]
                            };
                        });
                    });
            });

        return Application.getCompiledIndex(Application.getCompiledLinks(branches));
    }

    private getBranchHTML(params: { name: string }): Promise<string> {
        const commits = this.getCommitList(params.name)
            .then((commits) => {
                return Promise.all(commits.map((item) => {
                    return this.getCommitStatus(params.name, item.sha)
                })).then((statuses) => {
                    return commits.map((item, i) => {
                        return {
                            url: `./${params.name}/commit/${item.sha}`,
                            text: item.message,
                            status: statuses[i]
                        }
                    });
                });
            })
            .then((commits) => {
                commits.push({ url: `./${params.name}/latest`, text: 'latest', status: null });
                return commits;
            });

        return Application.getCompiledIndex(Application.getCompiledLinks(commits));
    }

    private getBuildsHTML(params: { name: string; commit: string }): Promise<string> {
        const links = this.getBuildsList(params).then((list) => {
            return list.map((item) => {
                return { ...item, status: item.status ? 'success' : 'fail' };
            })
        });
        const contentPromise = Application.getCompiledLinks(links);

        return Application.getCompiledIndex(contentPromise);
    }

    private getLatestBuildHTML(params: { name: string }): Promise<string> {
        const links = getBranchList().then((branches) => {
            let commit = null;
            branches.some((item) => {
                if (item.name === params.name) {
                    commit = item.commit.sha;
                }
                return !!commit;
            });

            return commit;
        }).then((commit) => {
            return this.getBuildsList({ name: params.name, commit });
        }).then((builds) => {
            return builds.map((item) => {
                return { ...item, status: item.status ? 'success' : 'fail' };
            });
        });

        return Application.getCompiledIndex(Application.getCompiledLinks(links));
    }

}

new Router(parseArguments());
