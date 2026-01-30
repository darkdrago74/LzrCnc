#!/bin/bash

# -----------------------------------------------------------------------------
# dumbinitgit.sh - A git helper script
# -----------------------------------------------------------------------------
#
# This script helps with initializing a git repository and performing common
# git operations through a simple menu.
#
# USAGE:
# 1. Edit the variables in the 'CONFIGURATION' section below with your details.
# 2. Run the script: ./dumbinitgit.sh
#
# -----------------------------------------------------------------------------

# --- CONFIGURATION ---
# IMPORTANT: Fill these variables before the first run.
# After the first initialization, the script will replace these values for security.
# GITHUB_TOKEN, GITHUB_USERNAME, GITHUB_EMAIL, and REPO_URL must all be enclosed in double quotes.
GITHUB_TOKEN="AlreadyInit"
GITHUB_USERNAME="AlreadyInit"
GITHUB_EMAIL="AlreadyInit"
REPO_URL="https://github.com/darkdrago74/LzrCnc.git"
INITIALIZED="true"

# --- SCRIPT LOGIC ---

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to initialize the repository
initialize_repo() {
    echo "--- Repository Initialization ---"

    # Check for git
    if ! command_exists git; then
        echo "Error: git is not installed. Please install git and try again."
        exit 1
    fi

    # Validate configuration
    if [ "$GITHUB_TOKEN" = "TOBEMODIFIED" ] || [ "$GITHUB_USERNAME" = "TOBEMODIFIED" ] || [ "$GITHUB_EMAIL" = "TOBEMODIFIED" ]; then
        echo "Warning: Credentials are not set in the script."
        read -p "Do you want to enter them now? (y/n): " choice
        if [ "$choice" = "y" ] || [ "$choice" = "Y" ]; then
            read -p "Enter your GitHub Username: " GITHUB_USERNAME
            read -p "Enter your GitHub Email: " GITHUB_EMAIL
            read -s -p "Enter your GitHub Personal Access Token: " GITHUB_TOKEN
            echo
        else
            echo "Initialization aborted. Please fill in the details in the script and run again."
            exit 1
        fi
    fi

    local is_new_repo=true
    if [ -d ".git" ]; then
        is_new_repo=false
    fi

    if [ "$is_new_repo" = true ]; then
        echo "Initializing new git repository..."
        git init

        # Add this script to .gitignore to avoid committing it
        if ! grep -qxF "dumbinitgit.sh" .gitignore; then
            echo "Adding dumbinitgit.sh to .gitignore..."
            echo "dumbinitgit.gitattributes" >> .gitignore
        fi
    else
        echo "Existing git repository detected."
    fi


    git config user.name "$GITHUB_USERNAME"
    git config user.email "$GITHUB_EMAIL"

    echo "Configuring remote origin..."
    local remote_url="https://$GITHUB_TOKEN@$(echo $REPO_URL | sed 's|https://||')"
    # Check if remote origin exists
    if git remote get-url origin > /dev/null 2>&1; then
        git remote set-url origin "$remote_url"
    else
        git remote add origin "$remote_url"
    fi

    echo "Initialization successful."

    if [ "$is_new_repo" = true ]; then
        # Add all files and make an initial commit
        git add .
        git commit -m "Initial commit"
        echo "Initial commit created."
    fi

    # Clean up sensitive information from the script itself
    echo "Securing script: removing credentials..."
    sed -i 's/^GITHUB_TOKEN=.*/GITHUB_TOKEN="AlreadyInit"/' "$0"
    sed -i 's/^GITHUB_USERNAME=.*/GITHUB_USERNAME="AlreadyInit"/' "$0"
    sed -i 's/^GITHUB_EMAIL=.*/GITHUB_EMAIL="AlreadyInit"/' "$0"
    sed -i 's/^INITIALIZED=.*/INITIALIZED="true"/' "$0"

    echo "Script secured. Credentials have been removed."
    echo "---------------------------------"
}

# Function to execute a git command and handle errors
execute_git_command() {
    error_output=$("$@" 2>&1 >/dev/null)
    if [ $? -ne 0 ]; then
        echo -e "\033[1;31mError during operation:\033[0m"
        echo "$error_output"
        return 1
    else
        echo -e "\033[1;32mOperation successful!\033[0m"
        return 0
    fi
}

# --- MENU FOR GIT OPERATIONS ---

# Function to push changes
git_push() {
    echo "--- Push changes to GitHub ---"
    echo "This uploads your locally saved (committed) changes from your RPi for example to the GitHub project."
    echo "Example: After testing a change on your RPi for example, you use this to share it with the remote GitHub project."

    # Get local branches
    local_branches=$(git branch | sed 's/^..//')
    branch_count=$(echo "$local_branches" | wc -l)

    if [ "$branch_count" -eq 0 ]; then
        echo "No local branches found. Please create a branch and commit some changes first."
        return
    fi

    local branch
    if [ "$branch" ]; then
        branch=$local_branches
        echo "Only one local branch found: $branch. Pushing to this branch."
    else
        echo "Available local branches:"
        select b in $local_branches; do
            if [ -n "$b" ]; then
                branch=$b
                break
            else
                echo "Invalid selection. Please try again."
            fi
        done
    fi

    if [ -z "$branch" ]; then
        echo "Branch name cannot be empty."
        return
    fi

    # Execute git push and capture stderr
    error_output=$(git push origin "$branch" 2>&1 >/dev/null)

    # Check for errors
    if [ $? -ne 0 ]; then
        echo -e "\033[1;31mError during push:\033[0m"
        echo "$error_output"

        # Check for specific 'upstream' error
        if echo "$error_output" | grep -q "has no upstream branch"; then
            read -p "The current branch has no upstream branch. Do you want to set it now? (y/n): " choice
            if [ "$choice" = "y" ] || [ "$choice" = "Y" ]; then
                echo "Setting upstream and pushing again..."
                git push --set-upstream origin "$branch"
                if [ $? -eq 0 ]; then
                    echo -e "\033[1;32mPush successful!\033[0m"
                else
                    echo -e "\033[1;31mFailed to push even after setting upstream. Please check the errors above.\033[0m"
                fi
            fi
        fi
    else
        echo -e "\033[1;32mPush successful!\033[0m"
    fi
}

# Function to commit changes
git_commit() {
    echo "--- Commit (save) changes locally ---"
    echo "This saves a snapshot of your current changes on your RPi for example. Think of it as creating a local save point."
    echo -e "\033[1;33mImportant: After you commit, you must use 'Push' to upload your local save to the GitHub project.\033[0m"
    read -p "Enter your commit message (e.g., 'Added new sensor reading code'): " msg
    if [ -z "$msg" ]; then
        echo "Commit message cannot be empty."
        return
    fi
    # Add all files except the script itself
    git add .
    git reset --quiet HEAD -- dumbinitgit.sh
    execute_git_command git commit -m "$msg"
}

# Function to fetch changes
git_fetch() {
    echo "--- Fetch changes from GitHub ---"
    echo "This downloads the latest project history from the remote GitHub project to your local RPi for example, but doesn't change your files yet."
    echo "It's like checking for mail without opening it. 'Remote' is the GitHub project, 'local' is your RPi for example."
    if execute_git_command git fetch --all; then
        echo "Branches available on remote:"
        git branch -r
    fi
}

# Function to pull (fetch and merge) changes
git_pull() {
    echo "--- Pull (update) from GitHub ---"
    echo "This downloads the latest changes from the GitHub project and automatically merges them into your current working files on your RPi for example."
    echo "Use this to get the latest version of the project from GitHub."
    read -p "Enter the branch to pull from (e.g., main): " branch
    if [ -z "$branch" ]; then
        echo "Branch name cannot be empty."
        return
    fi
    execute_git_command git pull origin "$branch"
}

# Function to list branches
list_branches() {
    echo "--- List all branches ---"
    echo "This shows all versions of the project, both locally on your RPi for example and remotely on the GitHub project."
    echo "Local branches:"
    git branch
    echo ""
    echo "Remote branches:"
    git branch -r
}

# Function to create a new branch
create_branch() {
    echo "--- Create a new branch ---"
    echo "Creates a new branch on your local RPi for example and switches to it. Branches let you work on new features without affecting the main version."
    read -p "Enter the name for the new branch: " branch
    if [ -z "$branch" ]; then
        echo "Branch name cannot be empty."
        return
    fi
    execute_git_command git checkout -b "$branch"
}

# Function to switch branch
switch_branch() {
    echo "--- Switch to a different branch ---"
    echo "This changes your active set of files to a different version (branch)."
    read -p "Enter the branch name to switch to: " branch
    if [ -z "$branch" ]; then
        echo "Branch name cannot be empty."
        return
    fi
    execute_git_command git checkout "$branch"
}

# Function to reset local changes
git_reset_hard() {
    echo "--- DANGEROUS: reset_hard ---"
    echo -e "\033[1;31mWARNING: This will permanently delete ALL local changes on your RPi for example that you have not pushed to the GitHub project.\033[0m"
    echo "It resets your local folder to be an exact copy of the GitHub project's branch."
    read -p "Are you absolutely sure you want to do this? (yes/no): " confirmation
    if [ "$confirmation" != "yes" ]; then
        echo "Reset cancelled."
        return
    fi
    read -p "Enter the branch on GitHub to reset to (e.g., main): " branch
    if [ -z "$branch" ]; then
        echo "Branch name cannot be empty."
        return
    fi
    if execute_git_command git fetch origin; then
        execute_git_command git reset --hard "origin/$branch"
        echo "Local folder has been reset."
    fi
}


# Function to manage Git LFS
manage_git_lfs() {
    while true; do
        echo ""
        echo "--- Git LFS Management ---"
        echo "1. Track a file type (e.g., *.zip)"
        echo "2. Untrack a file type"
        echo "3. List tracked file types"
        echo "b. Back to Main Menu"
        echo "--------------------------"
        read -p "Choose an option: " choice

        case $choice in
            1)
                read -p "Enter file pattern to track (e.g., '*.zip', '*.mp4'): " pattern
                if [ -z "$pattern" ]; then
                    echo "Pattern cannot be empty."
                else
                    execute_git_command git lfs track "$pattern"
                fi
                ;;
            2)
                read -p "Enter file pattern to untrack: " pattern
                if [ -z "$pattern" ]; then
                    echo "Pattern cannot be empty."
                else
                    execute_git_command git lfs untrack "$pattern"
                fi
                ;;
            3)
                echo "--- Currently tracked Git LFS file types (from .gitattributes) ---"
                if [ -f .gitattributes ]; then
                    grep "filter=lfs" .gitattributes
                else
                    echo "No .gitattributes file found or no LFS patterns tracked."
                fi
                ;;
            b)
                break
                ;;
            *)
                echo "Invalid option. Please try again."
                ;;
        esac
    done
}

# Main menu function
show_menu() {
    while true; do
        echo ""
        echo "--- DumbInitGit Menu ---"
        echo "Workflow: 1. Commit -> 2. Push"
        echo "-----------------------------------------------------"
        echo "1. Commit (save changes on your RPi for example)"
        echo "2. Push (upload your RPi's changes to GitHub project)"
        echo ""
        echo "3. Pull (update your RPi for example with the latest from GitHub project)"
        echo "4. Fetch (check for remote changes without merging)"
        echo ""
        echo "5. List Branches"
        echo "6. Create Branch"
        echo "7. Switch Branch"
        echo ""
        echo "8. DANGEROUS: reset_hard (Reset RPi folder to match GitHub)"
        echo "9. Manage Git LFS (Large File Storage)"
        echo "q. Quit"
        echo "--------------------"
        read -p "Choose an option: " choice

        case $choice in
            1) git_commit ;;
            2) git_push ;;
            3) git_pull ;;
            4) git_fetch ;;
            5) list_branches ;;
            6) create_branch ;;
            7) switch_branch ;;
            8) git_reset_hard ;;
            9) manage_git_lfs ;;
            q) echo "Exiting dumbinitgit. Goodbye!"; exit 0 ;;
            *) echo "Invalid option. Please try again." ;;
        esac
    done
}

# --- MAIN SCRIPT EXECUTION ---

# If not initialized, run initialization first.
if [ "$INITIALIZED" = "false" ]; then
    initialize_repo
fi

# Show the main menu
show_menu
