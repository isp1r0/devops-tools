import { CoreOptions, get as requestGet, RequestResponse } from 'request';
import { red, yellow } from 'colors/safe';


export module GithubAPI {

    const cache: ICache = Object.create(null);
    cache.commitArchive = Object.create(null);
    cache.commitMessage = Object.create(null);

    export function getBranchList(force?: boolean): Promise<Array<Readonly<IBranch>>> {
        if (cache.branchList && !force) {
            return cache.branchList;
        }
        console.warn(yellow('Request github: get branch list!'));
        cache.branchList = get('https://api.github.com/repos/wavesplatform/WavesGUI/branches');
        cache.branchList.then((list) => {
            if (list.length === 0) {
                cache.branchList = null;
                console.log(yellow('Empty branch list!'));
            }
        }, () => {
            console.warn(red('Error get branch list!'));
            cache.branchList = null;
        });
        return cache.branchList;

    }

    export function getCommitArchive(sha: string): Promise<Buffer> {
        if (cache.commitArchive[sha]) {
            return cache.commitArchive[sha];
        }
        console.warn(yellow(`Request github: get archive by commit "${sha}"!`));
        cache.commitArchive[sha] = getFile(`https://codeload.github.com/wavesplatform/WavesGUI/zip/${sha}`);
        return cache.commitArchive[sha];

    }

    export function getCommitMessage(sha: string): Promise<string> {
        if (cache.commitMessage[sha]) {
            return cache.commitMessage[sha];
        }
        console.warn(yellow(`Request github: get commit message for commit "${sha}"!`));
        cache.commitMessage[sha] = get(`https://api.github.com/repos/wavesplatform/WavesGUI/git/commits/${sha}`).then((commit: ICommit) => {
            return commit.message;
        });
        cache.commitMessage[sha].catch((e) => {
            console.warn(red('Error get commitMessage!'));
            cache.commitMessage[sha] = null;
        });
        return cache.commitMessage[sha];
    }

    export function getCommitsList(shaList: Array<string>): Promise<Array<{ sha: string, message: string }>> {
        return Promise.all(shaList.map((sha) => {
            return getCommitMessage(sha).then((message) => {
                return { sha, message };
            }, (e) => {
                console.warn(red('Error get commit message!'));
                return { sha, message: 'Not found!' };
            });
        }));
    }

    interface ICache {
        branchList: Promise<Array<Readonly<IBranch>>>;
        commitArchive: {
            [commit: string]: Promise<Buffer>;
        }
        commitMessage: {
            [commit: string]: Promise<string>;
        }
    }
}


export interface IBranch {
    name: string;
    commit: {
        sha: string;
        url: string;
    }
}

export interface ICommit {
    sha: string;
    url: string;
    author: {
        date: string;
        name: string;
        email: string;
    },
    committer: {
        date: string;
        name: string;
        email: string;
    },
    message: string;
    tree: {
        url: string;
        sha: string;
    }
}

function get <T>(url: string, options?: CoreOptions): Promise<T> {
    options = options || Object.create(null);

    if (!options.headers) {
        options.headers = Object.create(null);
    }

    if (!options.headers['User-Agent']) {
        options.headers['User-Agent'] = 'Awesome-Octocat-App';
    }

    return new Promise((resolve, reject) => {
        requestGet(url, options, function (error: any, response: RequestResponse) {
            if (error) {
                reject(error);
            } else {
                if (response.statusCode === 200) {
                    if (response.headers['content-type'].indexOf('application/json') !== -1) {
                        resolve(JSON.parse(response.body));
                    } else {
                        resolve(response.body);
                    }
                } else {
                    reject(response);
                }
            }
        })
    });
}

function getFile(url: string, options?: CoreOptions): Promise<Buffer> {
    options = options || Object.create(null);
    return get(url, { encoding: null, ...options });
}
