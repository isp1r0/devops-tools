const paramsHash = Object.create(null);

export function cached(target, key: string, descriptor: any) {
    descriptor.value = cacheWrapCallback(descriptor.value);
}


export function cacheWrapCallback(callback, cacheTime?) {
    const key = callback;
    if (!cacheTime) {
        cacheTime = 1000 * 60 * 60;
    }
    if (!paramsHash[key]) {
        paramsHash[key] = Object.create(null);
    }
    const hash = paramsHash[key];

    return function (...args: Array<any>) {
        const argsKey = paramsToString(args);
        if (hash[argsKey] && Date.now() - hash[argsKey].time < cacheTime) {
            return hash[argsKey].result;
        } else {
            const result = callback.apply(this, args);
            hash[argsKey] = {
                time: Date.now(),
                result: result
            };
            return result;
        }
    }
}


function paramsToString(...args: Array<any>): string {
    return args.map((argument) => {
        switch (typeof argument) {
            case 'string':
                return argument;
            case 'function':
            case 'number':
            case 'boolean':
            case 'undefined':
                return String(argument);
            case 'object':
                return JSON.stringify(argument);
        }
    }).join('|||');
}
