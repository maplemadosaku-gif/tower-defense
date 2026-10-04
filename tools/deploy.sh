#!/bin/sh
# develop ブランチの www/ の中身を gh-pages ブランチへ反映して GitHub Pages を更新する
set -e
cd "$(dirname "$0")/.."
git push origin develop
git push origin "$(git subtree split --prefix www develop)":gh-pages
echo "公開URL: https://maplemadosaku-gif.github.io/tower-defense/ （反映まで1分ほど）"
