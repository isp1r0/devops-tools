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
            '/branch/:name/commit/:commit': (params: { name: string, commit: string }) => this.getBuildsHTML(params),
            '/branch/:name/latest': (params: { name: string }) => this.getLatestBuildHTML(params)
        }
    }

    private getIndexHTML(): Promise<string> {
        const branches = this.getBranchList()
            .then((names) => names.map(name => ({ url: `./branch/${name}`, text: name })));

        return Application.getCompiledIndex(Application.getCompiledLinks(branches));
    }

    private getBranchHTML(params: { name: string }): Promise<string> {
        const commits = this.getCommitList(params.name)
            .then((commits) => commits.map((commit) => {
                    return { url: `./${params.name}/commit/${commit.sha}`, text: commit.message };
                }
            ))
            .then((commits) => {
                commits.push({ url: `./${params.name}/latest`, text: 'latest' });
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
            return this.getBuildsList({name: params.name, commit});
        }).then((builds) => {
            return builds.map((item) => {
                return { ...item, status: item.status ? 'success' : 'fail' };
            });
        });

        return Application.getCompiledIndex(Application.getCompiledLinks(links));
    }

}

new Router(parseArguments());
