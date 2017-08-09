import { writeFile } from 'fs';
import { exec } from 'child_process';


const COLUMNS_FOR_PARSE = {
    'DisplayName': { name: 'displayName', format: String },
    'ShortName': { name: 'shortName', format: String },
    '.Decimals': { name: 'precision', format: Number },
    'Asset ID': { name: 'id', format: String }
};

const options = parseArguments() as { url: string, out: string };
const MY_LINE_DROP = '<--NEW_LINE-->';

if (!options.url) {
    console.error('Укажите урл для скачивания csv файла! url=http://some.csv.url');
    process.exit(1);
}

if (!options.out) {
    console.error('Укажите путь для вывода результата! out=/example.json');
    process.exit(1);
}

run(`curl "${options.url}"`)
    .then((content: string) => {

        const lines = escapeWrapped(content).split('\n').map((line) => line.replace(new RegExp(MY_LINE_DROP, 'g'), '\n'));
        lines.reverse();

        const names = lines.pop();
        const hash = Object.create(null);

        const hasAll = Object.keys(COLUMNS_FOR_PARSE).every((name: string) => {
            return names.split(',').some((tableName: string, i: number) => {
                if (name === tableName) {
                    hash[tableName] = i;
                    return true;
                }
            });
        });

        if (!hasAll) {
            console.error('Найдены не все колонки!');
            process.exit(1);
        }

        const result = [];

        lines.forEach((line) => {
            const columns = line.split(',');
            const item = Object.create(null);

            Object.keys(hash).forEach((name) => {
                const jsonName = COLUMNS_FOR_PARSE[name].name;
                const processor = COLUMNS_FOR_PARSE[name].format;
                const columnIndex = hash[name];
                item[jsonName] = processor(columns[columnIndex]);

                if (typeof item[jsonName] === 'string' && item[jsonName].includes('\n')) {
                    console.error('Запрещённый символ в ячейке!');
                    process.exit(1);
                }
            });

            const canAdd = Object.keys(item).every((name) => {
                return item[name] !== '';
            });

            if (canAdd) {
                result.push(item);
            } else {
                console.warn('Rejected item! ' + JSON.stringify(item));
            }
        });

        writeFile(options.out, JSON.stringify(result, null, 4), function (err) {
            if (err) {
                console.log(err.message);
                process.exit(1);
            }
        });
    })
    .catch((e) => {
        console.error(e.message);
        process.exit(1);
    });

function parseArguments<T>(): T {
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

function run(command: string) {
    return new Promise((resolve, reject) => {
        exec(command, function (error, log1, log2) {
            if (error) {
                reject(error);
            } else {
                resolve(log1);
            }
        })
    });
}

function escapeWrapped(content: string): string {
    let hasQuote = false;
    return content.split('').map((char) => {
        if (char === '"') {
            hasQuote = !hasQuote;
        }
        if (char === '\n') {
            if (hasQuote) {
                char = MY_LINE_DROP;
            }
        }
        return char;
    }).join('');
}
