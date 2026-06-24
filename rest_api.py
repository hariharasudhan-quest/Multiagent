from flask import Flask, jsonify, request

app = Flask(__name__)

# In-memory database (simulating a simple DB)
data = {
    'users': [
        {'id': 1, 'name': 'Alice'},
        {'id': 2, 'name': 'Bob'}
    ]
}

@app.route('/api/users', methods=['GET'])
def get_users():
    return jsonify(data['users'])

@app.route('/api/users/<int:user_id>', methods=['GET'])
def get_user(user_id):
    user = next((user for user in data['users'] if user['id'] == user_id), None)
    if user:
        return jsonify(user)
    return jsonify({'error': 'User not found'}), 404

@app.route('/api/users', methods=['POST'])
def create_user():
    new_user = {
        'id': len(data['users']) + 1,
        'name': request.json['name']
    }
    data['users'].append(new_user)
    return jsonify(new_user), 201

@app.route('/api/users/<int:user_id>', methods=['PUT'])
def update_user(user_id):
    user = next((user for user in data['users'] if user['id'] == user_id), None)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    user['name'] = request.json['name']
    return jsonify(user)

@app.route('/api/users/<int:user_id>', methods=['DELETE'])
def delete_user(user_id):
    global data
    data['users'] = [user for user in data['users'] if user['id'] != user_id]
    return jsonify({'message': 'User deleted'}), 204

if __name__ == '__main__':
    app.run(debug=True)
