import { CoreOptions, get as requestGet, RequestResponse } from 'request';


export function getBranchList(): Promise<Array<Readonly<IBranch>>> {
    return get('https://api.github.com/repos/wavesplatform/WavesGUI/branches');
}

export function getCommitArchive(sha: string): Promise<Buffer> {
    return getFile(`https://codeload.github.com/wavesplatform/WavesGUI/zip/${sha}`);
}

export function getCommitMessage(sha: string): Promise<string> {
    return get(`https://api.github.com/repos/wavesplatform/WavesGUI/git/commits/${sha}`).then((commit: ICommit) => {
        return commit.message;
    });
}

export function getCommitsList(shaList: Array<string>): Promise<Array<{ sha: string, message: string }>> {
    return Promise.all(shaList.map((sha) => {
        return getCommitMessage(sha).then((message) => {
            return { sha, message };
        });
    }));
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
