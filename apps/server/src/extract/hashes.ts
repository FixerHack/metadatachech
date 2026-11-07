import { createHash } from "node:crypto";
import fs from "node:fs";

export interface Hashes {
  md5: string;
  sha1: string;
  sha256: string;
}

export function hashFile(filePath: string): Promise<Hashes> {
  const md5 = createHash("md5");
  const sha1 = createHash("sha1");
  const sha256 = createHash("sha256");
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .on("data", (chunk) => {
        md5.update(chunk);
        sha1.update(chunk);
        sha256.update(chunk);
      })
      .on("error", reject)
      .on("end", () =>
        resolve({ md5: md5.digest("hex"), sha1: sha1.digest("hex"), sha256: sha256.digest("hex") }),
      );
  });
}
