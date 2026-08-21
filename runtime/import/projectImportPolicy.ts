const MEBIBYTE = 1024 * 1024;

export const PROJECT_IMPORT_LIMITS = Object.freeze({
  projectBytes: 24 * MEBIBYTE,
  packageFileCount: 128,
  packageConfigBytes: 2 * MEBIBYTE,
  packageAssetBytes: 6 * MEBIBYTE,
  packageTotalAssetBytes: 24 * MEBIBYTE,
  packageTotalBytes: 32 * MEBIBYTE,
});

const packageAssetPattern = /\.(?:png|jpe?g|webp|svg)$/i;

export const isCharacterPackageAsset = (file: Pick<File, "name">) =>
  packageAssetPattern.test(file.name);

export const validateProjectImportFile = (file: Pick<File, "name" | "size">) => {
  if (file.size > PROJECT_IMPORT_LIMITS.projectBytes) {
    throw new Error("Project file is larger than the 24 MB classroom limit.");
  }
};

export const validateCharacterPackageFiles = <
  T extends Pick<File, "name" | "size">,
>(files: readonly T[]) => {
  if (files.length > PROJECT_IMPORT_LIMITS.packageFileCount) {
    throw new Error("Character package has more than 128 files.");
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > PROJECT_IMPORT_LIMITS.packageTotalBytes) {
    throw new Error("Character package is larger than the 32 MB classroom limit.");
  }
  const configs = files.filter((file) => /\.(?:json|ya?ml)$/i.test(file.name));
  const oversizedConfig = configs.find(
    (file) => file.size > PROJECT_IMPORT_LIMITS.packageConfigBytes,
  );
  if (oversizedConfig) {
    throw new Error(`${oversizedConfig.name} is larger than the 2 MB config limit.`);
  }
  const assets = files.filter(isCharacterPackageAsset);
  const oversizedAsset = assets.find(
    (file) => file.size > PROJECT_IMPORT_LIMITS.packageAssetBytes,
  );
  if (oversizedAsset) {
    throw new Error(`${oversizedAsset.name} is larger than the 6 MB image limit.`);
  }
  const totalAssetBytes = assets.reduce((sum, file) => sum + file.size, 0);
  if (totalAssetBytes > PROJECT_IMPORT_LIMITS.packageTotalAssetBytes) {
    throw new Error("Character package images exceed the 24 MB classroom limit.");
  }
  return { assets, totalAssetBytes, totalBytes };
};
