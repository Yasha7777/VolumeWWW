#!/bin/bash
git add . ':!3dmodels'
git commit -m "$(date +'%Y-%m-%d %H:%M:%S')"
git push
