const { Buffer } = require('node:buffer')
const { EventEmitter } = require('node:events')
const { readFileSync } = require('node:fs')
const net = require('node:net');
const { join } = require('node:path')
var ping = require('ping');

const tcpUploadProgress = new EventEmitter

// const file = readFileSync(join(__dirname, '3withReset.bin'))
// const file = readFileSync(join(__dirname, '..', 'Boards', 'Alarm Panel', 'Alarm Panel', 'Production', 'Alarm Panel.bin'))
// const file = readFileSync(join(__dirname, '..', 'Boards', 'CVBoard', 'CVBoard', 'Production', 'CVBoard.bin'))
// const file = readFileSync(join(__dirname, '..', 'Boards', 'Control Panel', 'Control Panel', 'Production', 'Control Panel.bin'))
// const file = readFileSync(join(__dirname, '..', 'Boards', 'GPOBoard', 'GPOBoard', 'Production', 'GPOBoard.bin'))
// const file = readFileSync(join(__dirname, '..', 'Boards', 'GPIBoard', 'GPIBoard', 'Production', 'GPIBoard.bin'))
// const file = readFileSync(join(__dirname, '..', 'Boards', 'MIDIBoard', 'MIDIBoard', 'Production', 'MIDIBoard.bin'))
// const file = readFileSync(join(__dirname, '..', 'Boards', 'SerialBoard', 'SerialBoard', 'Production', 'SerialBoard.bin'))

// const cpFilePath = join(__dirname, '..', 'Boards', 'Control Panel', 'Control Panel', 'Production', 'Control Panel.bin')
// const apFilePath = join(__dirname, '..', 'Boards', 'Alarm Panel', 'Alarm Panel', 'Production', 'Alarm Panel.bin')

let pagesSent = 0;

const makePages = (filePath) => {
    const file = readFileSync(filePath)
    const numberOfBytes = file.length
    const numberOfPages = Math.ceil(file.length / 64)

    console.log(numberOfPages, "Rows", numberOfBytes, "Bytes")

    let pages = []

    let byteIdx = 0;
    for (let page = 0; page < numberOfPages; page++) {
        let pageBuffer = []
        if (page == numberOfPages - 1) {
            for (let pageByte = 0; pageByte < 64; pageByte++) {
                if (byteIdx >= numberOfBytes) pageBuffer.push(255)
                else {
                    pageBuffer.push(file[byteIdx])
                    byteIdx++
                }
            }
        } else {
            for (let pageByte = 0; pageByte < 64; pageByte++) {
                pageBuffer.push(file[byteIdx])
                byteIdx++
            }
        }
        pages[page] = pageBuffer
    }
    console.log("Length of pages =", pages.length)
    return pages
}

//pages.forEach((pg, idx) => console.log(idx, JSON.stringify(pg)))

// const clientOpts = { port: 11420, host: '192.168.1.15' }

const sendReset = async(ip) => {
    return new Promise((resolve, reject) => {
        const client = net.connect({ port: 11420, host: ip }, () => {
            // 'connect' listener.

            client.on('data', (data) => {

                if (data.toString().substring(0, 9) == "resetting") {
                    console.log("Received", data.toString())
                        //client.write("WBM:page" + Buffer.from([pagesSent & 0xFF, (pagesSent >> 8) & 0xFF]) + Buffer.from(pages[pagesSent]))
                    client.end()
                    client.destroy()
                }
            });
            client.on('end', () => {
                console.log('disconnected from server');
            });
            client.on('close', () => {
                resolve()
            })

            console.log('Sending Load Command');
            client.write('WBM:reset')
        });
    })
}

const sendLoad = async(ip, numberOfPages) => {
    return new Promise((resolve, reject) => {
        const client = net.connect({ port: 11420, host: ip }, () => {
            // 'connect' listener.

            client.on('data', (data) => {
                console.log("Received", data.toString())
                if (data.toString().substring(0, 6) == "pages:") {
                    console.log("DATA ->", data);
                    //client.write("WBM:page" + Buffer.from([pagesSent & 0xFF, (pagesSent >> 8) & 0xFF]) + Buffer.from(pages[pagesSent]))
                    client.end()
                    client.destroy()
                }
            });
            client.on('end', () => {
                console.log('disconnected from server');
            });
            client.on('close', () => {
                resolve()
            })

            console.log('Sending Load Command');
            client.write('WBM:load' + Buffer.from([numberOfPages & 0xFF, (numberOfPages >> 8) & 0xFF]))
        });
    })
}

const sendPage = async(ip, pages) => {
    return new Promise((resolve, reject) => {
        const sendThis = new Buffer.from(pages[pagesSent])
        let res = "error"
        const client = net.connect({ port: 11420, host: ip }, () => {

            client.on('data', (data) => {
                client.end()
                client.destroy()
                if (!Buffer.compare(data, sendThis)) res = "Match"
                else res = "Mismatch"
            });

            client.on('end', () => {
                console.log('disconnected from server');
            });

            client.on('close', () => {
                if (res === "Match") resolve(res)
                else resolve(res)
            })

            // console.log('Sending Page', pagesSent);

            let outBuff = Buffer.concat([
                Buffer.from('WBM:page'),
                Buffer.from([pagesSent & 0xFF, (pagesSent >> 8) & 0xFF]),
                sendThis
            ])

            client.write(outBuff)
        });
    })
}

const sendPages = async(ip, pages) => {
    pagesSent = 0;
    const numberOfPages = pages.length
    await pages.reduce(async(acc, NULL, idx) => {
        await acc
        const result = await sendPage(ip, pages)
        if (result !== "Match") {
            throw new Error("Read back mismatch page" + pagesSent)
        } else {
            tcpUploadProgress.emit('tcpUploadProgress', {
                state: 'uploading',
                progress: (((idx + 1) * 100) / numberOfPages).toFixed(1)
            })
        }
        pagesSent++

    }, Promise.resolve([]))
}

const sendBootToBootloader = async(ip) => {
    return new Promise(async(resolve, reject) => {
        let pass = false

        const client = net.connect({ port: 11420, host: ip }, () => {
            client.on('data', (data) => {
                console.log(data.toString())
                if (data.toString() === "BOOTING") {
                    pass = true
                    client.end()
                    client.destroy()
                }
            })
            client.on('close', () => {
                if (pass === true) {
                    resolve()
                } else {
                    reject()
                }
            })

            client.write(new Buffer.from("WBM:BOOTTOBOOT"))
        })
    })
}

const waitForDevice = async(ip) => {
    console.log("Waiting For Device")
    return new Promise(async(resolve, reject) => {
        const startPinging = async() => {
            const exit = (err) => {
                console.log("IN EXIT")
                clearInterval(pingInterval)
                clearTimeout(timeout)
                if (err) reject(new Error(err))
                else resolve()
            }

            const pingInterval = setInterval(() => {
                console.log("SENDING PING")
                ping.sys.probe(ip, (isAlive) => {
                    console.log("isAlive", isAlive)
                    if (isAlive) exit()
                }, { timeout: 1 })
            }, 1200);

            const timeout = setTimeout(() => {
                exit("Timed out waiting for bootloader")
            }, 10000);
        }


        setTimeout(() => {
            startPinging()
        }, 1000);
    })
}

const bootToBootloader = async(ip) => {
    return new Promise(async(resolve, reject) => {
        try {
            await sendBootToBootloader(ip)
            await waitForDevice(ip)
            resolve()
        } catch (error) {
            reject(error)
        }
    })
}

const uploadFirmware = async(ip, filePath) => {
    return new Promise(async(resolve, reject) => {
        try {
            const pages = makePages(filePath)
            await bootToBootloader(ip)
            await sendLoad(ip, pages.length)
            await sendPages(ip, pages)
            await sendReset(ip)
            await waitForDevice(ip)
            resolve()
        } catch (error) {
            reject(error)
        }
    })
}

tcpUploadProgress.on('tcpUploadProgress', (data) => {
    switch (data.state) {
        case 'uploading':
            console.log(data.progress)
            break;

        default:
            break;
    }
})

// const run = async() => {
//     try {
//         await uploadFirmware('192.168.1.15', apFilePath)
//     } catch (error) {
//         throw error
//     }
// }

// run()

module.exports = { uploadFirmware, tcpUploadProgress }