import { lookup } from 'mime';
import { join } from 'path';
import { IncomingMessage, ServerResponse } from 'http';
import { readFile } from 'fs-extra';

export class StaticServer {

    private roots: Array<string>;

    constructor(roots: Array<string>) {
        this.roots = roots.reverse();
    }


    public serve(req: IncomingMessage, res: ServerResponse): void {
        const roots = this.roots.slice();
        const contentType = lookup(req.url);

        const check = (root: string) => {
            const path = join(root, req.url);
            readFile(path).then((file: Buffer) => {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(file);
            })
                .catch(() => {
                    if (roots.length) {
                        check(roots.pop());
                    } else {
                        res.writeHead(404, null);
                        res.end('404 Not found!');
                    }
                });
        };

        check(roots.pop());
    }

}
