# ChordLab Public Website Package

This folder is the public website package with images. It is safe to publish on GitHub because it does not include the ChordLab app source code.

## Contents

- `index.html`
- `privacy.html`
- `styles.css`
- `.nojekyll`
- `assets/chordlab_logo.png`
- `assets/chordlab_app_icon.png`

## Recommended use

Use this folder for a separate public website repository, for example:

- `ChordLab-site`
- `ChordLab-support`

or use it as the only content in `kakitgameproduction/ChordLab` if you want that repository to be a website-only repository.

## GitHub Pages setup

1. Upload only the contents of this folder to the public repository.
2. Open `Settings > Pages`.
3. Set source to `Deploy from a branch`.
4. Select branch `main`.
5. Select folder `/ (root)`.
6. Save.

## Important

Do not upload the main `ChordVault` project folder if you want to keep the app code private.
